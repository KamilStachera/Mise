using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Mise.Api.Data;
using Mise.Api.Domain;
using Mise.Api.Services;

namespace Mise.Api.Features;

/// <summary>
/// Temporary /zmierzch Twilight quiz trainer backend: synced per-account progress and
/// cross-household leaderboards for all signed-in Google users (including unlinked friends).
/// </summary>
public static partial class ZmierzchEndpoints
{
    private const int MaxCards = 2000;
    private const int KnownBox = 3;
    private const int MaxBox = 4;

    private static readonly JsonSerializerOptions JsonOpts = new(JsonSerializerDefaults.Web);
    private static readonly HashSet<string> ValidParts = ["zmierzch", "ksiezyc", "zacmienie", "przed-switem", "saga"];
    private static readonly HashSet<int> ValidTimeLimits = [0, 10, 20, 30, 45, 60];

    [GeneratedRegex(@"^(all|custom|part:(zmierzch|ksiezyc|zacmienie|przed-switem|saga)|set:[a-z0-9-]{1,24})$")]
    private static partial Regex ScopeRegex();

    public static RouteGroupBuilder MapZmierzch(this RouteGroupBuilder api)
    {
        var g = api.MapGroup("/zmierzch").WithTags("Zmierzch");

        g.MapGet("/me", GetMeAsync);
        g.MapPut("/progress", SyncProgressAsync);
        g.MapPut("/profile", UpdateProfileAsync);
        g.MapPost("/attempts", RecordAttemptAsync);
        g.MapGet("/leaderboard", GetLeaderboardAsync);

        return api;
    }

    private sealed record QuizIdentity(string UserKey, string DefaultName, string? Picture);

    private static QuizIdentity? ResolveIdentity(Caller caller)
    {
        switch (caller.Kind)
        {
            case CallerKind.Member:
            case CallerKind.PersonalKey:
            {
                var key = People.NormalizeEmail(caller.Email ?? caller.Self?.Email)
                    ?? (caller.Self is { } s ? $"person:{s.Id}" : null);
                if (key is null) return null;
                var name = BestName(caller.Self?.Name, caller.Name, key);
                return new QuizIdentity(key, name, caller.Picture);
            }
            case CallerKind.Unlinked:
            {
                var key = People.NormalizeEmail(caller.Email);
                if (key is null) return null;
                var name = BestName(caller.Name, null, key);
                return new QuizIdentity(key, name, caller.Picture);
            }
            case CallerKind.DevBypass:
            {
                var acting = caller.Acting ?? caller.Self;
                var key = People.NormalizeEmail(acting?.Email ?? caller.Email)
                    ?? (acting is { } a ? $"dev:{a.Id}" : "dev@localhost");
                var name = BestName(acting?.Name, caller.Name, key);
                return new QuizIdentity(key, name, caller.Picture);
            }
            default:
                return null;
        }
    }

    private static string BestName(string? primary, string? secondary, string fallbackKey)
    {
        var candidate = !string.IsNullOrWhiteSpace(primary) ? primary.Trim()
            : !string.IsNullOrWhiteSpace(secondary) ? secondary.Trim()
            : fallbackKey.Split('@')[0];
        return candidate.Length > 40 ? candidate[..40] : candidate;
    }

    private static async Task<IResult> GetMeAsync(Caller caller, MiseDbContext db, CancellationToken ct)
    {
        var id = ResolveIdentity(caller);
        if (id is null) return Results.Unauthorized();

        var player = await db.ZmierzchPlayers.AsNoTracking()
            .FirstOrDefaultAsync(p => p.UserKey == id.UserKey, ct);

        if (player is null)
        {
            return Results.Ok(new ZmierzchMeDto(
                PlayerId: null,
                DisplayName: id.DefaultName,
                Picture: id.Picture,
                Progress: new Dictionary<string, ZmierzchCardDto>(),
                PersonalBests: new Dictionary<string, ZmierzchPersonalBestDto>()));
        }

        var attempts = await db.ZmierzchAttempts.AsNoTracking()
            .Where(a => a.PlayerId == player.Id && a.Scope != "custom")
            .ToListAsync(ct);

        var bests = BuildPersonalBests(attempts);
        return Results.Ok(new ZmierzchMeDto(
            PlayerId: player.Id,
            DisplayName: player.DisplayName,
            Picture: player.Picture ?? id.Picture,
            Progress: ParseProgress(player.ProgressJson),
            PersonalBests: bests));
    }

    private static async Task<IResult> SyncProgressAsync(
        ZmierzchProgressInput input,
        Caller caller,
        MiseDbContext db,
        CancellationToken ct)
    {
        var id = ResolveIdentity(caller);
        if (id is null) return Results.Unauthorized();
        if (input.Progress is null)
            return Results.BadRequest(new { error = "Brak danych postępu." });
        if (input.Progress.Count > MaxCards)
            return Results.BadRequest(new { error = $"Za dużo kart postępu (maks. {MaxCards})." });

        var replace = string.Equals(input.Mode, "replace", StringComparison.OrdinalIgnoreCase);
        var incoming = SanitizeProgress(input.Progress);

        var player = await EnsurePlayerAsync(db, id, ct);
        var merged = replace ? incoming : MergeProgress(ParseProgress(player.ProgressJson), incoming);
        if (merged.Count > MaxCards)
            return Results.BadRequest(new { error = $"Za dużo kart postępu (maks. {MaxCards})." });

        player.ProgressJson = JsonSerializer.Serialize(merged, JsonOpts);
        if (!string.IsNullOrWhiteSpace(id.Picture)) player.Picture = id.Picture;
        player.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);

        return Results.Ok(new ZmierzchProgressSyncDto(merged, player.UpdatedAt));
    }

    private static async Task<IResult> UpdateProfileAsync(
        ZmierzchProfileInput input,
        Caller caller,
        MiseDbContext db,
        CancellationToken ct)
    {
        var id = ResolveIdentity(caller);
        if (id is null) return Results.Unauthorized();

        var name = (input.DisplayName ?? "").Trim();
        if (name.Length is < 1 or > 40)
            return Results.BadRequest(new { error = "Nazwa musi mieć od 1 do 40 znaków." });

        var player = await EnsurePlayerAsync(db, id, ct);
        player.DisplayName = name;
        if (!string.IsNullOrWhiteSpace(id.Picture)) player.Picture = id.Picture;
        player.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);

        return Results.Ok(new ZmierzchProfileDto(player.Id, player.DisplayName, player.Picture));
    }

    private static async Task<IResult> RecordAttemptAsync(
        ZmierzchAttemptInput input,
        Caller caller,
        MiseDbContext db,
        CancellationToken ct)
    {
        var id = ResolveIdentity(caller);
        if (id is null) return Results.Unauthorized();

        var scope = (input.Scope ?? "").Trim().ToLowerInvariant();
        if (!ScopeRegex().IsMatch(scope))
            return Results.BadRequest(new { error = "Nieprawidłowy zakres quizu." });
        if (input.Total is < 1 or > 1000)
            return Results.BadRequest(new { error = "Liczba pytań musi mieścić się między 1 a 1000." });
        if (input.Correct < 0 || input.Correct > input.Total)
            return Results.BadRequest(new { error = "Liczba poprawnych odpowiedzi jest poza zakresem." });
        if (input.DurationMs is < 0 or > 86_400_000)
            return Results.BadRequest(new { error = "Nieprawidłowy czas trwania rundy." });
        if (!ValidTimeLimits.Contains(input.TimeLimitSeconds))
            return Results.BadRequest(new { error = "Nieprawidłowy limit czasu." });

        var player = await EnsurePlayerAsync(db, id, ct);
        if (!string.IsNullOrWhiteSpace(id.Picture)) player.Picture = id.Picture;
        player.UpdatedAt = DateTimeOffset.UtcNow;

        var isFixedSet = scope.StartsWith("set:", StringComparison.Ordinal);
        var prevAttempts = scope == "custom"
            ? []
            : await db.ZmierzchAttempts.AsNoTracking()
                .Where(a => a.PlayerId == player.Id && a.Scope == scope)
                .ToListAsync(ct);
        var prevBest = PickBestRun(prevAttempts, isFixedSet);

        var attempt = new ZmierzchAttempt
        {
            PlayerId = player.Id,
            Scope = scope,
            Correct = input.Correct,
            Total = input.Total,
            DurationMs = input.DurationMs,
            TimeLimitSeconds = input.TimeLimitSeconds,
            CompletedAt = DateTimeOffset.UtcNow,
        };
        db.ZmierzchAttempts.Add(attempt);
        await db.SaveChangesAsync(ct);

        var isPersonalBest = scope != "custom" && (prevBest is null || CompareRuns(attempt, prevBest, isFixedSet) < 0);
        int? rank = null;
        int totalPlayers = 0;

        if (scope != "custom")
        {
            var scopeAttempts = await db.ZmierzchAttempts.AsNoTracking()
                .Where(a => a.Scope == scope)
                .ToListAsync(ct);
            var ranked = RankRuns(scopeAttempts, isFixedSet);
            totalPlayers = ranked.Count;
            var idx = ranked.FindIndex(r => r.Best.PlayerId == player.Id);
            if (idx >= 0) rank = idx + 1;
        }

        return Results.Ok(new ZmierzchAttemptResultDto(
            attempt.Id,
            attempt.Scope,
            attempt.Correct,
            attempt.Total,
            Pct(attempt.Correct, attempt.Total),
            attempt.DurationMs,
            attempt.TimeLimitSeconds,
            attempt.CompletedAt,
            isPersonalBest,
            rank,
            totalPlayers));
    }

    private static async Task<IResult> GetLeaderboardAsync(
        string? scope,
        Caller caller,
        MiseDbContext db,
        CancellationToken ct)
    {
        var id = ResolveIdentity(caller);
        if (id is null) return Results.Unauthorized();

        var normalizedScope = string.IsNullOrWhiteSpace(scope) ? "all" : scope.Trim().ToLowerInvariant();
        if (normalizedScope == "custom" || !ScopeRegex().IsMatch(normalizedScope))
            return Results.BadRequest(new { error = "Nieprawidłowy zakres rankingu." });

        var players = await db.ZmierzchPlayers.AsNoTracking().ToListAsync(ct);
        var playerById = players.ToDictionary(p => p.Id);
        var me = players.FirstOrDefault(p => p.UserKey == id.UserKey);

        var allAttempts = await db.ZmierzchAttempts.AsNoTracking()
            .Where(a => a.Scope != "custom")
            .ToListAsync(ct);

        var scopeCounts = allAttempts
            .GroupBy(a => a.Scope)
            .ToDictionary(grp => grp.Key, grp => grp.Select(a => a.PlayerId).Distinct().Count());

        var isFixedSet = normalizedScope.StartsWith("set:", StringComparison.Ordinal);
        var scopeAttempts = allAttempts.Where(a => a.Scope == normalizedScope).ToList();
        var rankedRuns = RankRuns(scopeAttempts, isFixedSet);

        var runEntries = rankedRuns.Select((entry, i) =>
        {
            playerById.TryGetValue(entry.Best.PlayerId, out var p);
            return new ZmierzchRunLeaderDto(
                Rank: i + 1,
                PlayerId: entry.Best.PlayerId,
                Name: p?.DisplayName ?? "Gracz",
                Picture: p?.Picture,
                IsMe: me is not null && entry.Best.PlayerId == me.Id,
                Correct: entry.Best.Correct,
                Total: entry.Best.Total,
                Pct: Pct(entry.Best.Correct, entry.Best.Total),
                DurationMs: entry.Best.DurationMs,
                TimeLimitSeconds: entry.Best.TimeLimitSeconds,
                Attempts: entry.Attempts,
                CompletedAt: entry.Best.CompletedAt);
        }).ToList();

        var masteryEntries = new List<ZmierzchMasteryLeaderDto>();
        if (!isFixedSet)
        {
            var partFilter = normalizedScope.StartsWith("part:", StringComparison.Ordinal)
                ? normalizedScope["part:".Length..]
                : null;
            var bestByPlayer = rankedRuns.ToDictionary(r => r.Best.PlayerId, r => r.Best);

            var rawMastery = new List<(ZmierzchPlayer Player, int Known, int Learning, int Seen, int MasteryScore, int Accuracy, int TotalAnswers, ZmierzchAttempt? BestRun)>();
            foreach (var p in players)
            {
                var prog = ParseProgress(p.ProgressJson);
                int known = 0, learning = 0, masteryScore = 0, totalAnswers = 0, correctAnswers = 0;
                foreach (var card in prog.Values)
                {
                    if (card.Seen <= 0) continue;
                    if (partFilter is not null && !string.Equals(card.Part, partFilter, StringComparison.Ordinal))
                        continue;
                    if (card.Box >= KnownBox) known++;
                    else learning++;
                    masteryScore += Math.Min(card.Box, KnownBox);
                    totalAnswers += card.Seen;
                    correctAnswers += Math.Max(0, card.Seen - card.Wrong);
                }
                var seen = known + learning;
                if (seen == 0) continue;
                var accuracy = totalAnswers > 0 ? (int)Math.Round(100.0 * correctAnswers / totalAnswers) : 0;
                bestByPlayer.TryGetValue(p.Id, out var best);
                rawMastery.Add((p, known, learning, seen, masteryScore, accuracy, totalAnswers, best));
            }

            rawMastery.Sort((a, b) =>
            {
                var c = b.Known.CompareTo(a.Known);
                if (c != 0) return c;
                c = b.MasteryScore.CompareTo(a.MasteryScore);
                if (c != 0) return c;
                c = b.Accuracy.CompareTo(a.Accuracy);
                if (c != 0) return c;
                c = b.Seen.CompareTo(a.Seen);
                if (c != 0) return c;
                return a.Player.CreatedAt.CompareTo(b.Player.CreatedAt);
            });

            masteryEntries = rawMastery.Select((m, i) => new ZmierzchMasteryLeaderDto(
                Rank: i + 1,
                PlayerId: m.Player.Id,
                Name: m.Player.DisplayName,
                Picture: m.Player.Picture,
                IsMe: me is not null && m.Player.Id == me.Id,
                Known: m.Known,
                Learning: m.Learning,
                Seen: m.Seen,
                Accuracy: m.Accuracy,
                TotalAnswers: m.TotalAnswers,
                BestCorrect: m.BestRun?.Correct,
                BestTotal: m.BestRun?.Total,
                BestDurationMs: m.BestRun?.DurationMs)).ToList();
        }

        var myBests = me is null
            ? new Dictionary<string, ZmierzchPersonalBestDto>()
            : BuildPersonalBests(allAttempts.Where(a => a.PlayerId == me.Id));

        return Results.Ok(new ZmierzchLeaderboardDto(
            Scope: normalizedScope,
            Runs: runEntries,
            Mastery: masteryEntries,
            ScopeCounts: scopeCounts,
            PersonalBests: myBests));
    }

    private static async Task<ZmierzchPlayer> EnsurePlayerAsync(MiseDbContext db, QuizIdentity id, CancellationToken ct)
    {
        var existing = await db.ZmierzchPlayers.FirstOrDefaultAsync(p => p.UserKey == id.UserKey, ct);
        if (existing is not null) return existing;

        var created = new ZmierzchPlayer
        {
            UserKey = id.UserKey,
            DisplayName = id.DefaultName,
            Picture = id.Picture,
            ProgressJson = "{}",
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.ZmierzchPlayers.Add(created);
        try
        {
            await db.SaveChangesAsync(ct);
            return created;
        }
        catch (DbUpdateException)
        {
            db.Entry(created).State = EntityState.Detached;
            return await db.ZmierzchPlayers.FirstAsync(p => p.UserKey == id.UserKey, ct);
        }
    }

    private static Dictionary<string, ZmierzchCardDto> ParseProgress(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return [];
        try
        {
            return JsonSerializer.Deserialize<Dictionary<string, ZmierzchCardDto>>(json, JsonOpts) ?? [];
        }
        catch (JsonException)
        {
            return [];
        }
    }

    private static Dictionary<string, ZmierzchCardDto> SanitizeProgress(Dictionary<string, ZmierzchCardDto> input)
    {
        var result = new Dictionary<string, ZmierzchCardDto>(StringComparer.Ordinal);
        foreach (var (rawId, card) in input)
        {
            if (string.IsNullOrWhiteSpace(rawId) || rawId.Length > 40 || card is null) continue;
            var id = rawId.Trim();
            var seen = Math.Max(0, card.Seen);
            var wrong = Math.Clamp(card.Wrong, 0, seen);
            var box = Math.Clamp(card.Box, 0, MaxBox);
            var last = Math.Max(0, card.Last);
            var part = card.Part is not null && ValidParts.Contains(card.Part) ? card.Part : null;
            result[id] = new ZmierzchCardDto(box, seen, wrong, last, part);
        }
        return result;
    }

    private static Dictionary<string, ZmierzchCardDto> MergeProgress(
        Dictionary<string, ZmierzchCardDto> server,
        Dictionary<string, ZmierzchCardDto> client)
    {
        var merged = new Dictionary<string, ZmierzchCardDto>(server, StringComparer.Ordinal);
        foreach (var (id, incoming) in client)
        {
            if (!merged.TryGetValue(id, out var existing))
            {
                merged[id] = incoming;
                continue;
            }
            var part = incoming.Part ?? existing.Part;
            if (incoming.Last > existing.Last || (incoming.Last == existing.Last && incoming.Seen >= existing.Seen))
                merged[id] = incoming with { Part = part };
            else if (existing.Part is null && part is not null)
                merged[id] = existing with { Part = part };
        }
        return merged;
    }

    private static List<(ZmierzchAttempt Best, int Attempts)> RankRuns(IEnumerable<ZmierzchAttempt> attempts, bool isFixedSet)
    {
        var perPlayer = attempts
            .GroupBy(a => a.PlayerId)
            .Select(grp => (Best: PickBestRun(grp, isFixedSet)!, Attempts: grp.Count()))
            .ToList();

        perPlayer.Sort((a, b) => CompareRuns(a.Best, b.Best, isFixedSet));
        return perPlayer;
    }

    private static ZmierzchAttempt? PickBestRun(IEnumerable<ZmierzchAttempt> attempts, bool isFixedSet)
    {
        ZmierzchAttempt? best = null;
        foreach (var a in attempts)
        {
            if (best is null || CompareRuns(a, best, isFixedSet) < 0)
                best = a;
        }
        return best;
    }

    /// <summary>Negative if <paramref name="a"/> ranks higher than <paramref name="b"/>.</summary>
    private static int CompareRuns(ZmierzchAttempt a, ZmierzchAttempt b, bool isFixedSet)
    {
        if (isFixedSet)
        {
            var c = b.Correct.CompareTo(a.Correct);
            if (c != 0) return c;
            c = b.Total.CompareTo(a.Total);
            if (c != 0) return c;
            c = a.DurationMs.CompareTo(b.DurationMs);
            if (c != 0) return c;
            return a.CompletedAt.CompareTo(b.CompletedAt);
        }

        // General scopes (all / part:*): higher accuracy % wins; ties broken by larger question count,
        // then faster average answering speed per question.
        var pctCmp = ((long)b.Correct * a.Total).CompareTo((long)a.Correct * b.Total);
        if (pctCmp != 0) return pctCmp;
        var countCmp = b.Correct.CompareTo(a.Correct);
        if (countCmp != 0) return countCmp;
        var speedCmp = ((long)a.DurationMs * b.Total).CompareTo((long)b.DurationMs * a.Total);
        if (speedCmp != 0) return speedCmp;
        return a.CompletedAt.CompareTo(b.CompletedAt);
    }

    private static Dictionary<string, ZmierzchPersonalBestDto> BuildPersonalBests(IEnumerable<ZmierzchAttempt> attempts)
    {
        var result = new Dictionary<string, ZmierzchPersonalBestDto>(StringComparer.Ordinal);
        foreach (var grp in attempts.GroupBy(a => a.Scope))
        {
            var isFixedSet = grp.Key.StartsWith("set:", StringComparison.Ordinal);
            var best = PickBestRun(grp, isFixedSet);
            if (best is null) continue;
            result[grp.Key] = new ZmierzchPersonalBestDto(
                best.Correct,
                best.Total,
                Pct(best.Correct, best.Total),
                best.DurationMs,
                grp.Count(),
                best.CompletedAt);
        }
        return result;
    }

    private static int Pct(int correct, int total) => total > 0 ? (int)Math.Round(100.0 * correct / total) : 0;
}

public sealed record ZmierzchCardDto(int Box, int Seen, int Wrong, long Last, string? Part = null);

public sealed record ZmierzchProgressInput(Dictionary<string, ZmierzchCardDto>? Progress, string? Mode = null);

public sealed record ZmierzchProgressSyncDto(Dictionary<string, ZmierzchCardDto> Progress, DateTimeOffset UpdatedAt);

public sealed record ZmierzchProfileInput(string? DisplayName);

public sealed record ZmierzchProfileDto(Guid PlayerId, string DisplayName, string? Picture);

public sealed record ZmierzchAttemptInput(string? Scope, int Correct, int Total, int DurationMs, int TimeLimitSeconds);

public sealed record ZmierzchAttemptResultDto(
    Guid Id,
    string Scope,
    int Correct,
    int Total,
    int Pct,
    int DurationMs,
    int TimeLimitSeconds,
    DateTimeOffset CompletedAt,
    bool IsPersonalBest,
    int? Rank,
    int TotalPlayers);

public sealed record ZmierzchPersonalBestDto(
    int Correct,
    int Total,
    int Pct,
    int DurationMs,
    int Attempts,
    DateTimeOffset CompletedAt);

public sealed record ZmierzchMeDto(
    Guid? PlayerId,
    string DisplayName,
    string? Picture,
    Dictionary<string, ZmierzchCardDto> Progress,
    Dictionary<string, ZmierzchPersonalBestDto> PersonalBests);

public sealed record ZmierzchRunLeaderDto(
    int Rank,
    Guid PlayerId,
    string Name,
    string? Picture,
    bool IsMe,
    int Correct,
    int Total,
    int Pct,
    int DurationMs,
    int TimeLimitSeconds,
    int Attempts,
    DateTimeOffset CompletedAt);

public sealed record ZmierzchMasteryLeaderDto(
    int Rank,
    Guid PlayerId,
    string Name,
    string? Picture,
    bool IsMe,
    int Known,
    int Learning,
    int Seen,
    int Accuracy,
    int TotalAnswers,
    int? BestCorrect,
    int? BestTotal,
    int? BestDurationMs);

public sealed record ZmierzchLeaderboardDto(
    string Scope,
    List<ZmierzchRunLeaderDto> Runs,
    List<ZmierzchMasteryLeaderDto> Mastery,
    Dictionary<string, int> ScopeCounts,
    Dictionary<string, ZmierzchPersonalBestDto> PersonalBests);
