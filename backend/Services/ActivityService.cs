using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Mise.Api.Data;
using Mise.Api.Domain;

namespace Mise.Api.Services;

// ---- HC Webhook payload (github.com/mcnaveen/health-connect-webhook, docs/webhook.md) ----
// Root: timestamp, app_version + one snake_case array per enabled type, omitted when empty.
// Times are ISO-8601 UTC instants. Only the types Pichci uses are bound; the rest are ignored.

public sealed record HcPayload(
    [property: JsonPropertyName("active_calories")] List<HcEnergy>? ActiveCalories,
    [property: JsonPropertyName("total_calories")] List<HcEnergy>? TotalCalories,
    [property: JsonPropertyName("weight")] List<HcWeight>? Weight,
    [property: JsonPropertyName("exercise")] List<HcExercise>? Exercise);

public sealed record HcEnergy(
    [property: JsonPropertyName("calories")] decimal Calories,
    [property: JsonPropertyName("start_time")] DateTimeOffset StartTime,
    [property: JsonPropertyName("end_time")] DateTimeOffset EndTime);

public sealed record HcWeight(
    [property: JsonPropertyName("kilograms")] decimal Kilograms,
    [property: JsonPropertyName("time")] DateTimeOffset Time);

/// <summary>Type is documented as a string; accept a number too (the raw Health Connect constant).</summary>
public sealed record HcExercise(
    [property: JsonPropertyName("type")] JsonElement Type,
    [property: JsonPropertyName("start_time")] DateTimeOffset StartTime,
    [property: JsonPropertyName("end_time")] DateTimeOffset EndTime,
    [property: JsonPropertyName("duration_seconds")] int? DurationSeconds);

public sealed record HcIngestResult(int Energy, int Workouts, int Weights, int WeightsIgnored = 0);

public enum SyncState { None, Connected, Stale }

/// <summary>One day of activity: active kcal (band + manual workouts) and its workouts.</summary>
public sealed record ActivityDay(DateOnly Date, int ActiveKcal, List<(Workout Workout, int? Kcal)> Workouts);

/// <summary>
/// Band and scale data via Health Connect, plus manual workouts. A day's active kcal =
/// band Active samples (or Total − BMR when the band writes only Total) + manual workouts.
/// Band workouts get their kcal from the samples inside their window, so they never add twice.
/// Reads and the token belong to the request's <see cref="PersonScope"/>; ingest belongs to the
/// person whose token the phone posts to.
/// </summary>
public class ActivityService(MiseDbContext db, PersonScope? person = null)
{
    public int PersonId { get; } = (person ?? PersonScope.Default).Id;

    /// <summary>No data for this long = "brak danych" (the band app syncs roughly hourly).</summary>
    public static readonly TimeSpan StaleAfter = TimeSpan.FromHours(24);

    /// <summary>
    /// A scale weight this far from the person's recent weigh-ins is someone else's (the scale is
    /// shared) and is dropped. Real change is ~1 kg a week, so 5 kg within a month never trips it.
    /// </summary>
    public const decimal ForeignWeightKg = 5m;
    public const int ForeignWeightWindowDays = 30;

    /// <summary>Calendar day in the server's zone (TZ=Europe/Warsaw in docker-compose).</summary>
    public static DateOnly LocalDate(DateTimeOffset t) => DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(t, TimeZoneInfo.Local).DateTime);

    public static SyncState State(HealthSync? sync, DateTimeOffset now) =>
        sync?.LastSyncAt is not DateTimeOffset last ? SyncState.None
        : now - last > StaleAfter ? SyncState.Stale
        : SyncState.Connected;

    // ---- token ----

    public async Task<HealthSync> SyncAsync(bool rotate = false, CancellationToken ct = default)
    {
        var sync = await db.HealthSyncs.FirstOrDefaultAsync(s => s.PersonId == PersonId, ct);
        if (sync is null)
        {
            sync = new HealthSync { PersonId = PersonId };
            db.HealthSyncs.Add(sync);
            rotate = true;
        }
        if (rotate)
        {
            sync.Token = Convert.ToHexString(RandomNumberGenerator.GetBytes(16)).ToLowerInvariant();
            sync.CreatedAt = DateTimeOffset.UtcNow;
            sync.LastSyncAt = null;
        }
        await db.SaveChangesAsync(ct);
        return sync;
    }

    public Task<HealthSync?> CurrentSyncAsync(CancellationToken ct = default) =>
        db.HealthSyncs.AsNoTracking().FirstOrDefaultAsync(s => s.PersonId == PersonId, ct);

    /// <summary>Constant-time token check against every person's phone; null when the token is unknown.</summary>
    public async Task<HealthSync?> AuthorizeAsync(string token, CancellationToken ct = default)
    {
        var candidate = System.Text.Encoding.ASCII.GetBytes(token);
        HealthSync? match = null;
        foreach (var sync in await db.HealthSyncs.ToListAsync(ct))
        {
            if (string.IsNullOrEmpty(sync.Token) || token.Length != sync.Token.Length) continue;
            if (CryptographicOperations.FixedTimeEquals(candidate, System.Text.Encoding.ASCII.GetBytes(sync.Token)))
                match = sync;
        }
        return match;
    }

    // ---- ingest ----

    /// <summary>Upserts everything in one payload. Records are re-sent when updated, so every write is idempotent.</summary>
    public async Task<HcIngestResult> IngestAsync(HealthSync sync, HcPayload payload, CancellationToken ct = default)
    {
        var pid = sync.PersonId;
        var energy = 0;
        var incoming = (payload.ActiveCalories ?? []).Concat(payload.TotalCalories ?? []).ToList();
        // A 48 h window can hold thousands of short intervals: load the existing ones in one query.
        var existing = new Dictionary<(EnergyKind, long, long), EnergySample>();
        if (incoming.Count > 0)
        {
            var min = incoming.Min(s => s.StartTime).ToUniversalTime();
            var max = incoming.Max(s => s.StartTime).ToUniversalTime();
            foreach (var row in await db.EnergySamples.Where(x => x.PersonId == pid && x.Start >= min && x.Start <= max).ToListAsync(ct))
                existing[(row.Kind, row.Start.UtcTicks, row.End.UtcTicks)] = row;
        }
        foreach (var (kind, list) in new[] { (EnergyKind.Active, payload.ActiveCalories), (EnergyKind.Total, payload.TotalCalories) })
        {
            foreach (var s in list ?? [])
            {
                if (s.Calories < 0 || s.EndTime < s.StartTime) continue;
                var key = (kind, s.StartTime.UtcTicks, s.EndTime.UtcTicks);
                if (!existing.TryGetValue(key, out var row))
                {
                    row = new EnergySample { PersonId = pid, Kind = kind, Start = s.StartTime.ToUniversalTime(), End = s.EndTime.ToUniversalTime(), Date = LocalDate(s.StartTime) };
                    db.EnergySamples.Add(row);
                    existing[key] = row;
                }
                row.Kcal = Math.Round(s.Calories, 2);
                row.ReceivedAt = DateTimeOffset.UtcNow;
                energy++;
            }
        }

        var workouts = 0;
        foreach (var x in payload.Exercise ?? [])
        {
            if (x.EndTime <= x.StartTime) continue;
            var key = $"{x.StartTime.UtcDateTime:O}|{x.EndTime.UtcDateTime:O}";
            // Local first: the same record can appear twice in one batch before anything is saved.
            var row = db.Workouts.Local.FirstOrDefault(w => w.PersonId == pid && w.ExternalKey == key)
                ?? await db.Workouts.FirstOrDefaultAsync(w => w.PersonId == pid && w.ExternalKey == key, ct);
            if (row is null)
            {
                row = new Workout { PersonId = pid, ExternalKey = key, Source = MeasurementSource.HealthConnect };
                db.Workouts.Add(row);
            }
            row.Date = LocalDate(x.StartTime);
            row.StartedAt = x.StartTime.ToUniversalTime();
            row.Minutes = (int)Math.Round((x.DurationSeconds ?? (x.EndTime - x.StartTime).TotalSeconds) / 60.0);
            row.Type = ExerciseLabel(x.Type);
            workouts++;
        }

        var weights = 0;
        var ignored = 0;
        var incomingWeights = (payload.Weight ?? []).Where(w => w.Kilograms is >= 25 and <= 350).OrderBy(w => w.Time).ToList();
        // Recent weigh-ins of this person: the reference for spotting the other person's reading.
        var known = new List<WeightEntry>();
        if (incomingWeights.Count > 0)
        {
            var since = LocalDate(incomingWeights[0].Time).AddDays(-ForeignWeightWindowDays);
            known = await db.WeightEntries.Where(x => x.PersonId == pid && x.Date >= since).ToListAsync(ct);
        }
        foreach (var w in incomingWeights)
        {
            var date = LocalDate(w.Time);
            var reference = known.Where(x => x.Date < date && x.Date >= date.AddDays(-ForeignWeightWindowDays))
                .OrderByDescending(x => x.Date).FirstOrDefault();
            if (reference is not null && Math.Abs(reference.Kg - w.Kilograms) > ForeignWeightKg)
            {
                ignored++;
                continue;
            }
            var row = known.FirstOrDefault(x => x.Date == date);
            if (row is not null && (row.Source == MeasurementSource.Manual || (row.MeasuredAt is DateTimeOffset at && at <= w.Time)))
                continue;   // manual wins; keep the morning (earliest) scale reading
            if (row is null)
            {
                row = new WeightEntry { PersonId = pid, Date = date };
                db.WeightEntries.Add(row);
                known.Add(row);
            }
            row.Kg = Math.Round(w.Kilograms, 2);
            row.Source = MeasurementSource.HealthConnect;
            row.MeasuredAt = w.Time.ToUniversalTime();
            row.CreatedAt = DateTimeOffset.UtcNow;
            weights++;
        }

        sync.LastSyncAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);
        return new HcIngestResult(energy, workouts, weights, ignored);
    }

    // Health Connect ExerciseSessionRecord constants and their names, mapped to the design's chips.
    private static readonly (string Match, int Code, string Label)[] ExerciseTypes =
    [
        ("STRENGTH", 70, "Trening siłowy"),
        ("WEIGHTLIFTING", 81, "Trening siłowy"),
        ("WALKING", 79, "Spacer"),
        ("RUNNING", 56, "Bieganie"),
        ("BIKING", 8, "Rower"),
        ("YOGA", 83, "Joga"),
        ("SWIMMING", 74, "Basen"),
        ("SWIMMING_OPEN_WATER", 73, "Basen"),
        ("HIGH_INTENSITY", 36, "Trening interwałowy"),
        ("ELLIPTICAL", 25, "Orbitrek"),
        ("PILATES", 48, "Pilates"),
        ("DANCING", 16, "Taniec"),
        ("HIKING", 37, "Wędrówka"),
    ];

    public static string ExerciseLabel(JsonElement type)
    {
        if (type.ValueKind == JsonValueKind.Number && type.TryGetInt32(out var code))
            return ExerciseTypes.FirstOrDefault(t => t.Code == code).Label ?? "Trening";
        var name = type.ValueKind == JsonValueKind.String ? type.GetString() ?? "" : type.ToString();
        if (int.TryParse(name, out var asCode))
            return ExerciseTypes.FirstOrDefault(t => t.Code == asCode).Label ?? "Trening";
        var upper = name.ToUpperInvariant().Replace(' ', '_');
        return ExerciseTypes.FirstOrDefault(t => upper.Contains(t.Match)).Label ?? "Trening";
    }

    // ---- reading ----

    /// <summary>
    /// Active kcal per day in [from, to]. Band Active samples win; a day with only Total
    /// samples counts Total − BMR (pro rata for today); manual workouts always add.
    /// </summary>
    public async Task<List<ActivityDay>> DaysAsync(DateOnly from, DateOnly to, int? bmr, CancellationToken ct = default)
    {
        var samples = await db.EnergySamples.AsNoTracking()
            .Where(s => s.PersonId == PersonId && s.Date >= from && s.Date <= to).ToListAsync(ct);
        var workouts = await db.Workouts.AsNoTracking().Where(w => w.PersonId == PersonId && w.Date >= from && w.Date <= to)
            .OrderBy(w => w.StartedAt).ToListAsync(ct);
        var now = DateTimeOffset.Now;
        var today = LocalDate(now);

        var days = new List<ActivityDay>();
        for (var d = from; d <= to; d = d.AddDays(1))
        {
            var active = samples.Where(s => s.Date == d && s.Kind == EnergyKind.Active).ToList();
            decimal band;
            if (active.Count > 0)
            {
                band = active.Sum(s => s.Kcal);
            }
            else
            {
                var total = samples.Where(s => s.Date == d && s.Kind == EnergyKind.Total).Sum(s => s.Kcal);
                var share = d < today ? 1m : d == today ? (decimal)now.TimeOfDay.TotalHours / 24m : 0m;
                band = total > 0 && bmr is int b ? Math.Max(0, total - b * share) : 0;
            }
            var list = workouts.Where(w => w.Date == d).Select(w => (w, WorkoutKcal(w, active))).ToList();
            var manual = list.Where(x => x.w.Source == MeasurementSource.Manual).Sum(x => x.w.Kcal ?? 0);
            days.Add(new ActivityDay(d, (int)Math.Round(band) + manual, list));
        }
        return days;
    }

    /// <summary>Manual: as entered. Band: the Active samples that start inside the session.</summary>
    public static int? WorkoutKcal(Workout w, IReadOnlyCollection<EnergySample> active)
    {
        if (w.Source == MeasurementSource.Manual) return w.Kcal;
        if (w.StartedAt is not DateTimeOffset start) return null;
        var end = start.AddMinutes(w.Minutes);
        var inside = active.Where(s => s.Start >= start && s.Start < end).ToList();
        return inside.Count == 0 ? null : (int)Math.Round(inside.Sum(s => s.Kcal));
    }

    public async Task<Dictionary<DateOnly, int>> ActiveKcalAsync(DateOnly from, DateOnly to, int? bmr, CancellationToken ct = default) =>
        (await DaysAsync(from, to, bmr, ct)).ToDictionary(d => d.Date, d => d.ActiveKcal);
}
