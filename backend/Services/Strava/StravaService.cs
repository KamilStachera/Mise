using System.Collections.Concurrent;
using System.Net;
using System.Security.Cryptography;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Mise.Api.Data;
using Mise.Api.Domain;

namespace Mise.Api.Services.Strava;

public enum StravaConnectOutcome { Connected, MissingScope, Taken }

public enum StravaEventOutcome { Ignored, UnknownAthlete, Upserted, Deleted, StillAuthorized, Disconnected }

/// <summary>Who started the OAuth dance; carried through Strava inside the protected <c>state</c>.</summary>
public sealed record StravaState(int PersonId, int HouseholdId, string Nonce);

public sealed record StravaStatus(bool Configured, bool Connected, string? AthleteName, DateTimeOffset? ConnectedAt, DateTimeOffset? LastActivityAt);

/// <summary>Strava no longer accepts this person's tokens (they disconnected Pichci on Strava).</summary>
public sealed class StravaRevokedException(string message) : Exception(message);

/// <summary>Stored tokens could not be decrypted (DataProtection keys missing/rotated); keep the row so it isn't silently wiped.</summary>
public sealed class StravaDecryptException(string message) : Exception(message);

/// <summary>
/// Workouts from a watch via Strava (Garmin → Strava → Pichci). Each Strava activity becomes one
/// <see cref="Workout"/> (<c>Source = Strava</c>, <c>ExternalKey = strava:{id}</c>) carrying the
/// watch's kcal. Webhook events are hints only (Strava doesn't sign them): every change is
/// re-read from Strava with the athlete's own token first, so a forged event can at most make
/// us fetch real data again. Reads and connect/disconnect act for the request's
/// <see cref="PersonScope"/>; events and polls act for the connection's person.
/// </summary>
public class StravaService(MiseDbContext db, StravaClient client, StravaOptions options, IDataProtectionProvider protection,
    ILogger<StravaService>? logger = null, PersonScope? person = null)
{
    public int PersonId { get; } = (person ?? PersonScope.Default).Id;
    public StravaOptions Options => options;

    /// <summary>Connecting and "Pobierz teraz" pull this many days back (the activity screen shows 7).</summary>
    public const int BackfillDays = 7;
    /// <summary>Cap per pull: each activity costs a detail request (Strava allows ~100 per 15 min).</summary>
    public const int MaxImport = 30;

    private static readonly TimeSpan StateLifetime = TimeSpan.FromMinutes(15);
    private static readonly TimeSpan RefreshMargin = TimeSpan.FromMinutes(5);
    private static readonly ConcurrentDictionary<int, SemaphoreSlim> RefreshLocks = new();

    private IDataProtector Tokens => protection.CreateProtector("Pichci.Strava.Tokens.v1");
    private ITimeLimitedDataProtector States => protection.CreateProtector("Pichci.Strava.OAuthState.v1").ToTimeLimitedDataProtector();

    // ---- connect ----

    public (string Url, string Nonce) AuthorizeStart(string redirectUri, int householdId)
    {
        var nonce = Convert.ToHexString(RandomNumberGenerator.GetBytes(16)).ToLowerInvariant();
        var state = States.Protect($"{PersonId}:{householdId}:{nonce}", StateLifetime);
        return (StravaClient.AuthorizeUrl(options.ClientId!, redirectUri, state), nonce);
    }

    public string AuthorizeUrl(string redirectUri, int householdId) => AuthorizeStart(redirectUri, householdId).Url;

    /// <summary>Null when the state is missing, forged or older than 15 minutes.</summary>
    public StravaState? ReadState(string? state)
    {
        if (string.IsNullOrEmpty(state)) return null;
        try
        {
            var parts = States.Unprotect(state).Split(':');
            return parts.Length == 3 && int.TryParse(parts[0], out var p) && int.TryParse(parts[1], out var h)
                && parts[2].Length > 0
                ? new StravaState(p, h, parts[2])
                : null;
        }
        catch (CryptographicException)
        {
            return null;
        }
    }

    /// <summary>
    /// Finishes the OAuth redirect for <paramref name="personId"/> (already checked against the
    /// caller) and pulls the last week. The caller's tenant must be that person's household.
    /// </summary>
    public async Task<StravaConnectOutcome> ConnectAsync(int personId, string code, string? scope, CancellationToken ct = default)
    {
        // The athlete may untick "view private activities" etc. on Strava's consent screen.
        if (scope is null || !scope.Split(',').Any(s => s.Trim().StartsWith("activity:read", StringComparison.Ordinal)))
            return StravaConnectOutcome.MissingScope;

        var token = await client.ExchangeCodeAsync(options, code, ct);
        var athlete = token.Athlete ?? await client.GetAthleteAsync(token.AccessToken, ct);
        // Across households on purpose: one Strava account feeds one person's diary.
        if (await db.StravaConnections.IgnoreQueryFilters().AnyAsync(c => c.AthleteId == athlete.Id && c.PersonId != personId, ct))
            return StravaConnectOutcome.Taken;

        var conn = await db.StravaConnections.FirstOrDefaultAsync(c => c.PersonId == personId, ct);
        if (conn is null)
        {
            conn = new StravaConnection { PersonId = personId };
            db.StravaConnections.Add(conn);
        }
        conn.AthleteId = athlete.Id;
        var fullName = $"{athlete.FirstName} {athlete.LastName}".Trim();
        conn.AthleteName = fullName.Length > 120 ? fullName[..120] : fullName;
        conn.Scope = scope.Length > 200 ? scope[..200] : scope;
        conn.ConnectedAt = DateTimeOffset.UtcNow;
        Store(conn, token);
        await db.SaveChangesAsync(ct);

        try
        {
            await SyncAsync(conn, BackfillDays, refreshKnown: true, ct);
        }
        catch (Exception e) when (e is StravaApiException or HttpRequestException or TaskCanceledException)
        {
            // Connected anyway; the poll or the next webhook event catches up.
            logger?.LogWarning(e, "Strava backfill for person {Person} failed", personId);
        }
        return StravaConnectOutcome.Connected;
    }

    public Task<StravaConnection?> ConnectionAsync(CancellationToken ct = default) =>
        db.StravaConnections.FirstOrDefaultAsync(c => c.PersonId == PersonId, ct);

    public async Task<StravaStatus> StatusAsync(CancellationToken ct = default)
    {
        var c = await db.StravaConnections.AsNoTracking().FirstOrDefaultAsync(x => x.PersonId == PersonId, ct);
        return new StravaStatus(options.Configured, c is not null, c?.AthleteName, c?.ConnectedAt, c?.LastActivityAt);
    }

    /// <summary>Revokes Pichci on Strava (best effort) and forgets the tokens. Imported workouts stay.</summary>
    public async Task<bool> DisconnectAsync(CancellationToken ct = default)
    {
        var conn = await ConnectionAsync(ct);
        if (conn is null) return false;
        try
        {
            await client.DeauthorizeAsync(await AccessTokenAsync(conn, ct), ct);
        }
        catch (Exception e) when (e is StravaApiException or StravaRevokedException or StravaDecryptException or HttpRequestException or TaskCanceledException)
        {
            logger?.LogInformation(e, "Strava deauthorize for person {Person} failed; forgetting the tokens anyway", conn.PersonId);
        }
        db.StravaConnections.Remove(conn);
        await db.SaveChangesAsync(ct);
        return true;
    }

    // ---- import ----

    /// <summary>
    /// Pulls activities that started in the last <paramref name="days"/> days. Known ones are
    /// re-read only with <paramref name="refreshKnown"/> (manual "Pobierz teraz"); the
    /// background poll skips them to stay far below Strava's rate limits. Returns how many
    /// were written. A revoked connection is dropped and yields 0.
    /// </summary>
    public async Task<int> SyncAsync(StravaConnection conn, int days, bool refreshKnown, CancellationToken ct = default)
    {
        try
        {
            var token = await AccessTokenAsync(conn, ct);
            var since = DateTimeOffset.UtcNow.AddDays(-days);
            var fromDate = ActivityService.LocalDate(since).AddDays(-1);
            var list = (await client.ListActivitiesAsync(token, since, 50, ct)).OrderByDescending(a => a.StartDate).Take(MaxImport).ToList();
            var known = refreshKnown ? [] : (await db.Workouts
                .Where(w => w.PersonId == conn.PersonId && w.Source == MeasurementSource.Strava && w.Date >= fromDate)
                .Select(w => w.ExternalKey).ToListAsync(ct)).ToHashSet();
            var written = 0;
            foreach (var summary in list)
            {
                if (known.Contains(Key(summary.Id))) continue;
                if (await client.GetActivityAsync(token, summary.Id, ct) is not { } activity) continue;
                if (activity.Athlete is { Id: > 0 } a && a.Id != conn.AthleteId) continue;
                await UpsertAsync(conn, activity, ct);
                written++;
            }
            await db.SaveChangesAsync(ct);
            return written;
        }
        catch (StravaDecryptException e)
        {
            logger?.LogError("Strava sync skipped for person {Person}: {Reason}", conn.PersonId, e.Message);
            return 0;
        }
        catch (Exception e) when (IsRevoked(e))
        {
            await DropAsync(conn, e, ct);
            return 0;
        }
    }

    /// <summary>One webhook event, re-checked against Strava before anything changes.</summary>
    public async Task<StravaEventOutcome> HandleEventAsync(StravaEvent e, CancellationToken ct = default)
    {
        // Events carry no tenant: find the athlete in every household, then work inside theirs.
        var conn = await db.StravaConnections.IgnoreQueryFilters().FirstOrDefaultAsync(c => c.AthleteId == e.OwnerId, ct);
        if (conn is null) return StravaEventOutcome.UnknownAthlete;
        if (await IsPersonBlockedAsync(conn.PersonId, ct)) return StravaEventOutcome.Ignored;
        db.Tenant.UseHousehold(conn.HouseholdId);
        try
        {
            if (e.ObjectType == "athlete")
            {
                if (e.Updates?.TryGetValue("authorized", out var v) != true || v.ToString() != "false") return StravaEventOutcome.Ignored;
                // "Deauthorized" — believe it only if Strava now refuses the token.
                await client.GetAthleteAsync(await AccessTokenAsync(conn, ct), ct);
                return StravaEventOutcome.StillAuthorized;
            }
            if (e.ObjectType != "activity") return StravaEventOutcome.Ignored;

            var activity = await client.GetActivityAsync(await AccessTokenAsync(conn, ct), e.ObjectId, ct);
            if (activity is null)
            {
                // Gone on Strava (deleted, or made invisible to us) — only then drop our copy.
                var key = Key(e.ObjectId);
                var row = await db.Workouts.FirstOrDefaultAsync(w => w.PersonId == conn.PersonId && w.ExternalKey == key, ct);
                if (row is null) return StravaEventOutcome.Ignored;
                db.Workouts.Remove(row);
                await db.SaveChangesAsync(ct);
                return StravaEventOutcome.Deleted;
            }
            // Strava tokens can read other athletes' public activities by numeric id: verify ownership!
            if (activity.Athlete is { Id: > 0 } owner && owner.Id != conn.AthleteId)
                return StravaEventOutcome.Ignored;
            await UpsertAsync(conn, activity, ct);
            await db.SaveChangesAsync(ct);
            return StravaEventOutcome.Upserted;
        }
        catch (StravaDecryptException x)
        {
            logger?.LogError("Strava event skipped for person {Person}: {Reason}", conn.PersonId, x.Message);
            return StravaEventOutcome.Ignored;
        }
        catch (Exception x) when (IsRevoked(x))
        {
            await DropAsync(conn, x, ct);
            return StravaEventOutcome.Disconnected;
        }
    }

    public Task<bool> IsPersonBlockedAsync(int personId, CancellationToken ct = default) =>
        db.People.IgnoreQueryFilters().AsNoTracking()
            .AnyAsync(p => p.Id == personId && (p.BlockedAt != null || db.Households.Any(h => h.Id == p.HouseholdId && h.BlockedAt != null)), ct);

    private async Task UpsertAsync(StravaConnection conn, StravaActivity a, CancellationToken ct)
    {
        var key = Key(a.Id);
        var row = db.Workouts.Local.FirstOrDefault(w => w.PersonId == conn.PersonId && w.ExternalKey == key)
            ?? await db.Workouts.FirstOrDefaultAsync(w => w.PersonId == conn.PersonId && w.ExternalKey == key, ct);
        if (row is null)
        {
            // HouseholdId explicitly: the poll may run with a system tenant.
            row = new Workout { HouseholdId = conn.HouseholdId, PersonId = conn.PersonId, ExternalKey = key, Source = MeasurementSource.Strava };
            db.Workouts.Add(row);
        }
        Apply(row, a);
        conn.LastActivityAt = DateTimeOffset.UtcNow;
    }

    /// <summary>Activity → workout fields. Moving time (pauses out) when Strava has it.</summary>
    public static void Apply(Workout row, StravaActivity a)
    {
        row.Date = ActivityService.LocalDate(a.StartDate);
        row.StartedAt = a.StartDate.ToUniversalTime();
        var seconds = a.MovingTime > 0 ? a.MovingTime : a.ElapsedTime;
        row.Minutes = Math.Max(1, (int)Math.Round(seconds / 60.0));
        // kilojoules is mechanical work (power meter), not burned kcal — never a stand-in.
        row.Kcal = a.Calories is > 0 ? (int)Math.Round(a.Calories.Value) : null;
        row.Type = Label(a.SportType ?? a.Type);
    }

    public static string Key(long activityId) => $"strava:{activityId}";

    // Strava sport_type → the labels the band and the manual sheet use.
    private static readonly Dictionary<string, string> Labels = new(StringComparer.OrdinalIgnoreCase)
    {
        ["WeightTraining"] = "Trening siłowy",
        ["Walk"] = "Spacer",
        ["Run"] = "Bieganie", ["TrailRun"] = "Bieganie", ["VirtualRun"] = "Bieganie",
        ["Ride"] = "Rower", ["VirtualRide"] = "Rower", ["MountainBikeRide"] = "Rower", ["GravelRide"] = "Rower",
        ["EBikeRide"] = "Rower", ["EMountainBikeRide"] = "Rower", ["Velomobile"] = "Rower",
        ["Yoga"] = "Joga",
        ["Swim"] = "Basen",
        ["HighIntensityIntervalTraining"] = "Trening interwałowy", ["Crossfit"] = "Trening interwałowy",
        ["Elliptical"] = "Orbitrek",
        ["Pilates"] = "Pilates",
        ["Hike"] = "Wędrówka",
        ["Rowing"] = "Wioślarstwo", ["VirtualRow"] = "Wioślarstwo",
        ["StairStepper"] = "Schody",
    };

    public static string Label(string? sportType) =>
        sportType is not null && Labels.TryGetValue(sportType, out var label) ? label : "Trening";

    // ---- tokens ----

    private void Store(StravaConnection conn, StravaToken token)
    {
        conn.AccessToken = Tokens.Protect(token.AccessToken);
        conn.RefreshToken = Tokens.Protect(token.RefreshToken);
        conn.ExpiresAt = DateTimeOffset.FromUnixTimeSeconds(token.ExpiresAt);
    }

    /// <summary>
    /// A valid access token, refreshed (and the new pair saved) when it is about to expire.
    /// Serialized per person so overlapping webhook/poll/manual syncs never race on Strava's
    /// refresh-token rotation and accidentally drop the connection.
    /// </summary>
    private async Task<string> AccessTokenAsync(StravaConnection conn, CancellationToken ct)
    {
        if (conn.ExpiresAt - RefreshMargin > DateTimeOffset.UtcNow)
        {
            try { return Tokens.Unprotect(conn.AccessToken); }
            catch (CryptographicException)
            {
                throw new StravaDecryptException("Stored Strava tokens can't be decrypted (DataProtection keys changed).");
            }
        }

        var gate = RefreshLocks.GetOrAdd(conn.PersonId, _ => new SemaphoreSlim(1, 1));
        await gate.WaitAsync(ct);
        try
        {
            // Reload inside the lock in case another concurrent request just refreshed and rotated the token.
            if (db.Entry(conn).State != EntityState.Detached)
                await db.Entry(conn).ReloadAsync(ct);
            if (conn.ExpiresAt - RefreshMargin > DateTimeOffset.UtcNow)
                return Tokens.Unprotect(conn.AccessToken);

            var token = await client.RefreshAsync(options, Tokens.Unprotect(conn.RefreshToken), ct);
            Store(conn, token);
            await db.SaveChangesAsync(ct);
            return token.AccessToken;
        }
        catch (CryptographicException)
        {
            throw new StravaDecryptException("Stored Strava tokens can't be decrypted (DataProtection keys changed).");
        }
        catch (StravaApiException e) when (e.Status is HttpStatusCode.BadRequest or HttpStatusCode.Unauthorized)
        {
            throw new StravaRevokedException("Strava refused the refresh token: " + e.Message);
        }
        finally
        {
            gate.Release();
        }
    }

    private static bool IsRevoked(Exception e) =>
        e is StravaRevokedException or StravaApiException { Status: HttpStatusCode.Unauthorized };

    /// <summary>The person unlinked Pichci on Strava (or tokens are unreadable): forget the connection, keep the workouts.</summary>
    private async Task DropAsync(StravaConnection conn, Exception why, CancellationToken ct)
    {
        logger?.LogWarning("Strava connection of person {Person} dropped: {Reason}", conn.PersonId, why.Message);
        db.StravaConnections.Remove(conn);
        await db.SaveChangesAsync(ct);
    }
}
