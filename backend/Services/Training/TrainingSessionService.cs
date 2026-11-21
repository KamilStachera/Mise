using Microsoft.EntityFrameworkCore;
using Mise.Api.Data;
using Mise.Api.Domain;
using Mise.Api.Features;

namespace Mise.Api.Services.Training;

/// <summary>
/// Live workout session lifecycle, previous-performance prefill, personal records (PR) engine,
/// and Activity workout linking (auto-deduped against Health Connect and Strava by <see cref="ActivityService"/>).
/// Every query and write is strictly scoped to <see cref="PersonScope"/>.
/// </summary>
public sealed class TrainingSessionService(MiseDbContext db, PersonScope person)
{
    public sealed record ServiceResult<T>(T? Value, int StatusCode = 200, string? Error = null, Guid? ActiveSessionId = null)
    {
        public bool Ok => Error is null && StatusCode is >= 200 and < 300;
    }

    // ---- Pure PR & volume math (tested directly) ----

    /// <summary>Epley estimated 1RM for weighted sets. Returns 0 when weight or reps are non-positive.</summary>
    public static decimal Estimated1Rm(decimal? weightKg, int? reps)
    {
        if (weightKg is not decimal w || w <= 0 || reps is not int r || r <= 0) return 0m;
        return r == 1 ? Math.Round(w, 2) : Math.Round(w * (1m + r / 30m), 2);
    }

    public static decimal SetVolume(TrainingSessionSet set) =>
        set.Completed && set.WeightKg is decimal w && w > 0 && set.Reps is int r && r > 0
            ? Math.Round(w * r, 2)
            : 0m;

    public static decimal SessionVolume(IEnumerable<TrainingSessionSet> sets) =>
        Math.Round(sets.Sum(SetVolume), 2);

    public static int EstimateKcal(ProgramDayKind kind, int durationMinutes)
    {
        var rate = kind == ProgramDayKind.FollowAlong ? 5.5m : 4.5m;
        return Math.Clamp((int)Math.Round(Math.Max(1, durationMinutes) * rate), 0, 5000);
    }

    public static ExercisePrBaselineDto? ComputeBaseline(IEnumerable<TrainingSessionSet> completedSets, bool isTimed)
    {
        var list = completedSets.Where(s => s.Completed).ToList();
        if (list.Count == 0) return null;

        decimal? bestWeight = null;
        int? bestWeightReps = null;
        decimal? best1Rm = null;
        int? bestBwReps = null;
        int? bestSec = null;

        foreach (var s in list)
        {
            if (isTimed || (s.Seconds is > 0 && s.Reps is null))
            {
                if (s.Seconds is int sec && sec > (bestSec ?? 0)) bestSec = sec;
                continue;
            }
            if (s.WeightKg is decimal w && w > 0 && s.Reps is int r && r > 0)
            {
                if (bestWeight is null || w > bestWeight || (w == bestWeight && r > (bestWeightReps ?? 0)))
                {
                    bestWeight = w;
                    bestWeightReps = r;
                }
                var e1rm = Estimated1Rm(w, r);
                if (e1rm > (best1Rm ?? 0m)) best1Rm = e1rm;
            }
            else if (s.Reps is int br && br > 0)
            {
                if (br > (bestBwReps ?? 0)) bestBwReps = br;
            }
        }

        if (bestWeight is null && best1Rm is null && bestBwReps is null && bestSec is null) return null;
        return new ExercisePrBaselineDto(bestWeight, bestWeightReps, best1Rm, bestBwReps, bestSec);
    }

    /// <summary>
    /// Compares <paramref name="currentSets"/> against <paramref name="priorSetsByExercise"/> (sets from
    /// earlier completed sessions), stamps <see cref="TrainingSessionSet.IsPr"/> on beating sets, and
    /// returns the list of headline new PRs per exercise. First-ever sessions establish a baseline without
    /// firing false PR celebrations.
    /// </summary>
    public static List<SessionNewPrDto> EvaluateAndStampPrs(
        IReadOnlyList<TrainingSessionSet> currentSets,
        IReadOnlyDictionary<Guid, List<TrainingSessionSet>> priorSetsByExercise,
        IReadOnlyDictionary<Guid, Exercise> exercises)
    {
        foreach (var s in currentSets) s.IsPr = false;
        var results = new List<SessionNewPrDto>();

        foreach (var group in currentSets.Where(s => s.Completed).GroupBy(s => s.ExerciseId))
        {
            if (!priorSetsByExercise.TryGetValue(group.Key, out var priorList) || priorList.Count == 0)
                continue;

            var ex = exercises.GetValueOrDefault(group.Key);
            var isTimed = ex?.IsTimed == true || group.All(s => s.Seconds is > 0 && s.Reps is null);
            var prior = ComputeBaseline(priorList, isTimed);
            if (prior is null) continue;

            var name = ex is null ? "Ćwiczenie" : ExerciseCatalog.DisplayName(ex);

            if (isTimed)
            {
                var bestSet = group.Where(s => s.Seconds is > 0).OrderByDescending(s => s.Seconds).FirstOrDefault();
                if (bestSet?.Seconds is int sec && sec > (prior.BestSeconds ?? 0))
                {
                    foreach (var s in group.Where(x => x.Seconds == sec)) s.IsPr = true;
                    results.Add(new SessionNewPrDto(group.Key, name, "seconds", null, null, sec, null, prior.BestSeconds, sec));
                }
                continue;
            }

            var weighted = group.Where(s => s.WeightKg is > 0 && s.Reps is > 0).ToList();
            if (weighted.Count > 0)
            {
                var maxWeight = weighted.Max(s => s.WeightKg!.Value);
                var weightBeat = maxWeight > (prior.BestWeightKg ?? 0m);
                var best1RmSet = weighted.OrderByDescending(s => Estimated1Rm(s.WeightKg, s.Reps)).First();
                var max1Rm = Estimated1Rm(best1RmSet.WeightKg, best1RmSet.Reps);
                var est1RmBeat = prior.BestEst1RmKg is decimal prev1Rm && max1Rm > prev1Rm;

                if (weightBeat)
                {
                    var topWeightSet = weighted.Where(s => s.WeightKg == maxWeight).OrderByDescending(s => s.Reps).First();
                    foreach (var s in weighted.Where(x => x.WeightKg == maxWeight)) s.IsPr = true;
                    if (est1RmBeat) best1RmSet.IsPr = true;
                    results.Add(new SessionNewPrDto(
                        group.Key, name, "weight", maxWeight, topWeightSet.Reps, null,
                        Estimated1Rm(maxWeight, topWeightSet.Reps), prior.BestWeightKg, maxWeight));
                }
                else if (est1RmBeat)
                {
                    best1RmSet.IsPr = true;
                    results.Add(new SessionNewPrDto(
                        group.Key, name, "est-1rm", best1RmSet.WeightKg, best1RmSet.Reps, null,
                        max1Rm, prior.BestEst1RmKg, max1Rm));
                }
                continue;
            }

            // Bodyweight reps (only when prior baseline had no weighted lifts for this exercise)
            if (prior.BestWeightKg is null)
            {
                var bestBw = group.Where(s => s.Reps is > 0).OrderByDescending(s => s.Reps).FirstOrDefault();
                if (bestBw?.Reps is int reps && reps > (prior.BestBodyweightReps ?? 0))
                {
                    foreach (var s in group.Where(x => x.Reps == reps)) s.IsPr = true;
                    results.Add(new SessionNewPrDto(group.Key, name, "reps", null, reps, null, null, prior.BestBodyweightReps, reps));
                }
            }
        }

        return results;
    }

    // ---- Queries ----

    public async Task<TrainingSessionSummaryDto?> GetActiveSummaryAsync(CancellationToken ct = default)
    {
        var active = await db.TrainingSessions.AsNoTracking()
            .Include(s => s.Sets)
            .FirstOrDefaultAsync(s => s.PersonId == person.Id && s.FinishedAt == null, ct);
        return active is null ? null : ToSummary(active);
    }

    public async Task<List<TrainingSessionSummaryDto>> GetCompletedOnDateAsync(DateOnly date, CancellationToken ct = default)
    {
        var rows = await db.TrainingSessions.AsNoTracking()
            .Include(s => s.Sets)
            .Where(s => s.PersonId == person.Id && s.FinishedAt != null && s.Date == date)
            .ToListAsync(ct);
        return rows.OrderByDescending(s => s.FinishedAt).Select(ToSummary).ToList();
    }

    /// <summary>Map of ProgramDayId → latest finished session (id, finishedAt) for this person.</summary>
    public async Task<Dictionary<Guid, (Guid SessionId, DateTimeOffset FinishedAt)>> GetCompletedDayMapAsync(
        IEnumerable<Guid> programDayIds, CancellationToken ct = default)
    {
        var ids = programDayIds.Distinct().ToList();
        if (ids.Count == 0) return [];
        var rows = await db.TrainingSessions.AsNoTracking()
            .Where(s => s.PersonId == person.Id && s.FinishedAt != null && s.ProgramDayId != null && ids.Contains(s.ProgramDayId.Value))
            .Select(s => new { s.Id, ProgramDayId = s.ProgramDayId!.Value, FinishedAt = s.FinishedAt!.Value })
            .ToListAsync(ct);
        return rows
            .GroupBy(r => r.ProgramDayId)
            .ToDictionary(
                g => g.Key,
                g =>
                {
                    var latest = g.OrderByDescending(x => x.FinishedAt).First();
                    return (latest.Id, latest.FinishedAt);
                });
    }

    public async Task<List<TrainingSessionSummaryDto>> ListSessionsAsync(int limit = 30, CancellationToken ct = default)
    {
        var take = Math.Clamp(limit, 1, 100);
        var rows = await db.TrainingSessions.AsNoTracking()
            .Include(s => s.Sets)
            .Where(s => s.PersonId == person.Id)
            .ToListAsync(ct);
        return rows
            .OrderByDescending(s => s.FinishedAt == null)
            .ThenByDescending(s => s.Date)
            .ThenByDescending(s => s.StartedAt)
            .Take(take)
            .Select(ToSummary)
            .ToList();
    }

    public async Task<TrainingSessionDetailDto?> GetDetailAsync(Guid sessionId, CancellationToken ct = default)
    {
        var session = await db.TrainingSessions.AsNoTracking()
            .Include(s => s.Sets).ThenInclude(set => set.Exercise)
            .FirstOrDefaultAsync(s => s.Id == sessionId && s.PersonId == person.Id, ct);
        if (session is null) return null;
        return await BuildDetailDtoAsync(session, ct);
    }

    public async Task<List<ExercisePrDto>> ListPrsAsync(CancellationToken ct = default)
    {
        var finished = await db.TrainingSessions.AsNoTracking()
            .Include(s => s.Sets).ThenInclude(set => set.Exercise)
            .Where(s => s.PersonId == person.Id && s.FinishedAt != null)
            .ToListAsync(ct);

        var flat = finished
            .SelectMany(s => s.Sets.Where(set => set.Completed).Select(set => (Session: s, Set: set)))
            .ToList();

        var result = new List<ExercisePrDto>();
        foreach (var group in flat.GroupBy(x => x.Set.ExerciseId))
        {
            var ex = group.First().Set.Exercise;
            if (ex is null) continue;
            var isTimed = ex.IsTimed || group.All(x => x.Set.Seconds is > 0 && x.Set.Reps is null);

            decimal? bestWeight = null;
            int? bestWeightReps = null;
            DateOnly? bestWeightDate = null;
            decimal? best1Rm = null;
            DateOnly? best1RmDate = null;
            int? bestBwReps = null;
            DateOnly? bestBwDate = null;
            int? bestSec = null;
            DateOnly? bestSecDate = null;

            foreach (var item in group.OrderBy(x => x.Session.Date).ThenBy(x => x.Session.StartedAt))
            {
                var set = item.Set;
                var d = item.Session.Date;
                if (isTimed || (set.Seconds is > 0 && set.Reps is null))
                {
                    if (set.Seconds is int sec && sec > (bestSec ?? 0))
                    {
                        bestSec = sec;
                        bestSecDate = d;
                    }
                    continue;
                }
                if (set.WeightKg is decimal w && w > 0 && set.Reps is int r && r > 0)
                {
                    if (bestWeight is null || w > bestWeight || (w == bestWeight && r > (bestWeightReps ?? 0)))
                    {
                        bestWeight = w;
                        bestWeightReps = r;
                        bestWeightDate = d;
                    }
                    var e1rm = Estimated1Rm(w, r);
                    if (e1rm > (best1Rm ?? 0m))
                    {
                        best1Rm = e1rm;
                        best1RmDate = d;
                    }
                }
                else if (set.Reps is int br && br > 0)
                {
                    if (br > (bestBwReps ?? 0))
                    {
                        bestBwReps = br;
                        bestBwDate = d;
                    }
                }
            }

            var sessionCount = group.Select(x => x.Session.Id).Distinct().Count();
            var lastDate = group.Max(x => x.Session.Date);
            result.Add(new ExercisePrDto(
                ex.Id, ExerciseCatalog.DisplayName(ex), ex.NameEn, ExerciseTokens.Of(ex.Equipment),
                ExerciseTokens.MuscleTokens(ex.PrimaryMuscles), isTimed,
                ex.ImagePaths.Count > 0 ? ExerciseEndpoints.ImageUrl(ex.Id, 0) : null,
                bestWeight, bestWeightReps, bestWeightDate,
                best1Rm, best1RmDate,
                bestBwReps, bestBwDate,
                bestSec, bestSecDate,
                sessionCount, group.Count(), lastDate));
        }

        return result
            .OrderByDescending(x => x.LastPerformedDate)
            .ThenBy(x => x.Name, StringComparer.Create(new System.Globalization.CultureInfo("pl-PL"), ignoreCase: true))
            .ToList();
    }

    // ---- Commands ----

    public async Task<ServiceResult<TrainingSessionDetailDto>> StartAsync(StartSessionInput input, CancellationToken ct = default)
    {
        var completeNow = input.CompleteNow == true;
        if (!completeNow)
        {
            var existingActive = await db.TrainingSessions.AsNoTracking()
                .FirstOrDefaultAsync(s => s.PersonId == person.Id && s.FinishedAt == null, ct);
            if (existingActive is not null)
                return new(null, 409, "Masz już rozpoczęty trening — dokończ go albo usuń, zanim zaczniesz nowy.", existingActive.Id);
        }

        var now = DateTimeOffset.UtcNow;
        var date = input.Date ?? ActivityService.LocalDate(now);
        var notes = (input.Notes ?? "").Trim();
        if (notes.Length > 1000) return new(null, 400, "Notatka: maks. 1000 znaków.");

        TrainingSession session;
        ProgramDay? day = null;

        if (input.ProgramDayId is Guid dayId)
        {
            day = await db.ProgramDays.AsNoTracking()
                .Include(d => d.Program)
                .Include(d => d.Exercises).ThenInclude(e => e.Exercise)
                .FirstOrDefaultAsync(d => d.Id == dayId && d.Program!.PersonId == person.Id, ct);
            if (day is null) return new(null, 404, "Nie znaleziono dnia w Twoim planie.");

            session = new TrainingSession
            {
                PersonId = person.Id,
                ProgramId = day.ProgramId,
                ProgramDayId = day.Id,
                Name = day.Name,
                Kind = day.Kind,
                Date = date,
                StartedAt = now,
                Notes = notes,
            };

            if (day.Kind == ProgramDayKind.Exercises)
            {
                var ordered = day.Exercises.OrderBy(e => e.Order).ToList();
                var exIds = ordered.Select(e => e.ExerciseId).Distinct().ToList();
                var lastMap = await LoadLastPerformanceAsync(exIds, excludeSessionId: null, ct);

                var order = 0;
                foreach (var slot in ordered)
                {
                    var isTimed = slot.Exercise?.IsTimed == true || slot.Seconds is > 0;
                    lastMap.TryGetValue(slot.ExerciseId, out var lastPerf);
                    for (var setNo = 1; setNo <= Math.Max(1, slot.Sets); setNo++)
                    {
                        var prev = lastPerf is not null && lastPerf.Sets.Count > 0
                            ? lastPerf.Sets[Math.Min(setNo - 1, lastPerf.Sets.Count - 1)]
                            : null;
                        session.Sets.Add(new TrainingSessionSet
                        {
                            SessionId = session.Id,
                            ExerciseId = slot.ExerciseId,
                            ProgramExerciseId = slot.Id,
                            ExerciseOrder = order,
                            SetNumber = setNo,
                            TargetRepsMin = slot.RepsMin,
                            TargetRepsMax = slot.RepsMax,
                            TargetSeconds = slot.Seconds,
                            TargetKg = slot.TargetKg,
                            RestSeconds = slot.RestSeconds,
                            SupersetGroup = slot.SupersetGroup,
                            WeightKg = isTimed ? null : (prev?.WeightKg ?? slot.TargetKg),
                            Reps = isTimed ? null : (prev?.Reps ?? slot.RepsMin ?? slot.RepsMax),
                            Seconds = isTimed ? (prev?.Seconds ?? slot.Seconds ?? 30) : null,
                            Completed = false,
                        });
                    }
                    order++;
                }
            }
        }
        else
        {
            var name = (input.Name ?? "").Trim();
            if (name.Length == 0) name = "Trening własny";
            if (name.Length > 120) return new(null, 400, "Nazwa treningu: 1–120 znaków.");

            session = new TrainingSession
            {
                PersonId = person.Id,
                Name = name,
                Kind = ProgramDayKind.Exercises,
                Date = date,
                StartedAt = now,
                Notes = notes,
            };

            var exIds = (input.ExerciseIds ?? []).Distinct().Take(20).ToList();
            if (exIds.Count > 0)
            {
                var catalog = await db.Exercises.AsNoTracking()
                    .Where(e => exIds.Contains(e.Id))
                    .ToDictionaryAsync(e => e.Id, ct);
                var lastMap = await LoadLastPerformanceAsync(exIds, excludeSessionId: null, ct);

                var order = 0;
                foreach (var exId in exIds)
                {
                    if (!catalog.TryGetValue(exId, out var ex)) continue;
                    lastMap.TryGetValue(exId, out var lastPerf);
                    var defaultRest = ex.IsTimed ? 45 : 75;
                    var setCount = lastPerf is not null && lastPerf.Sets.Count is >= 1 and <= 6 ? lastPerf.Sets.Count : 3;
                    for (var setNo = 1; setNo <= setCount; setNo++)
                    {
                        var prev = lastPerf is not null && lastPerf.Sets.Count > 0
                            ? lastPerf.Sets[Math.Min(setNo - 1, lastPerf.Sets.Count - 1)]
                            : null;
                        session.Sets.Add(new TrainingSessionSet
                        {
                            SessionId = session.Id,
                            ExerciseId = exId,
                            ExerciseOrder = order,
                            SetNumber = setNo,
                            TargetRepsMin = ex.IsTimed ? null : 10,
                            TargetRepsMax = ex.IsTimed ? null : 12,
                            TargetSeconds = ex.IsTimed ? 30 : null,
                            RestSeconds = defaultRest,
                            WeightKg = ex.IsTimed ? null : prev?.WeightKg,
                            Reps = ex.IsTimed ? null : (prev?.Reps ?? 10),
                            Seconds = ex.IsTimed ? (prev?.Seconds ?? 30) : null,
                        });
                    }
                    order++;
                }
            }
        }

        if (completeNow)
        {
            var minutes = input.DurationMinutes ?? day?.VideoMinutes ?? 30;
            if (minutes is < 1 or > 600) return new(null, 400, "Czas treningu: 1–600 min.");
            var kcal = input.EstimatedKcal ?? EstimateKcal(session.Kind, minutes);
            if (kcal is < 0 or > 5000) return new(null, 400, "Szacowane kcal: 0–5000.");

            session.StartedAt = now.AddMinutes(-minutes);
            session.FinishedAt = now;
            session.DurationMinutes = minutes;
            session.EstimatedKcal = kcal;

            var workout = CreateLinkedWorkout(session, day?.WorkoutType, minutes, kcal);
            db.Workouts.Add(workout);
            session.WorkoutId = workout.Id;
        }

        db.TrainingSessions.Add(session);
        await db.SaveChangesAsync(ct);

        var detail = await GetDetailAsync(session.Id, ct);
        return new(detail, 201);
    }

    public async Task<ServiceResult<TrainingSessionDetailDto>> PatchSessionAsync(Guid sessionId, PatchSessionInput input, CancellationToken ct = default)
    {
        var session = await db.TrainingSessions.FirstOrDefaultAsync(s => s.Id == sessionId && s.PersonId == person.Id, ct);
        if (session is null) return new(null, 404, "Nie znaleziono sesji treningowej.");

        if (input.Name is not null)
        {
            var name = input.Name.Trim();
            if (name.Length is 0 or > 120) return new(null, 400, "Nazwa treningu: 1–120 znaków.");
            session.Name = name;
        }
        if (input.Notes is not null)
        {
            var notes = input.Notes.Trim();
            if (notes.Length > 1000) return new(null, 400, "Notatka: maks. 1000 znaków.");
            session.Notes = notes;
        }

        await db.SaveChangesAsync(ct);
        return new(await GetDetailAsync(session.Id, ct));
    }

    public async Task<ServiceResult<SessionSetDto>> PatchSetAsync(Guid sessionId, Guid setId, PatchSessionSetInput input, CancellationToken ct = default)
    {
        var set = await db.TrainingSessionSets
            .Include(s => s.Session)
            .FirstOrDefaultAsync(s => s.Id == setId && s.SessionId == sessionId && s.Session!.PersonId == person.Id, ct);
        if (set is null) return new(null, 404, "Nie znaleziono serii.");

        if (input.ClearWeight == true) set.WeightKg = null;
        else if (input.WeightKg is decimal w)
        {
            if (w is < 0 or > 1000) return new(null, 400, "Ciężar: 0–1000 kg.");
            set.WeightKg = Math.Round(w, 2);
        }

        if (input.ClearReps == true) set.Reps = null;
        else if (input.Reps is int r)
        {
            if (r is < 0 or > 500) return new(null, 400, "Powtórzenia: 0–500.");
            set.Reps = r;
        }

        if (input.ClearSeconds == true) set.Seconds = null;
        else if (input.Seconds is int sec)
        {
            if (sec is < 0 or > 7200) return new(null, 400, "Czas: 0–7200 s.");
            set.Seconds = sec;
        }

        if (input.Completed is bool done)
        {
            set.Completed = done;
            set.CompletedAt = done ? (set.CompletedAt ?? DateTimeOffset.UtcNow) : null;
        }

        if (input.Notes is not null)
        {
            var notes = input.Notes.Trim();
            if (notes.Length > 200) return new(null, 400, "Notatka serii: maks. 200 znaków.");
            set.Notes = notes;
        }

        await db.SaveChangesAsync(ct);
        return new(ToSetDto(set));
    }

    public async Task<ServiceResult<TrainingSessionDetailDto>> AddSetAsync(Guid sessionId, AddSessionSetInput input, CancellationToken ct = default)
    {
        var session = await db.TrainingSessions
            .Include(s => s.Sets)
            .FirstOrDefaultAsync(s => s.Id == sessionId && s.PersonId == person.Id, ct);
        if (session is null) return new(null, 404, "Nie znaleziono sesji treningowej.");

        var exercise = await db.Exercises.AsNoTracking().FirstOrDefaultAsync(e => e.Id == input.ExerciseId, ct);
        if (exercise is null) return new(null, 400, "Nie ma takiego ćwiczenia w katalogu.");

        if (input.WeightKg is < 0 or > 1000) return new(null, 400, "Ciężar: 0–1000 kg.");
        if (input.Reps is < 0 or > 500) return new(null, 400, "Powtórzenia: 0–500.");
        if (input.Seconds is < 0 or > 7200) return new(null, 400, "Czas: 0–7200 s.");

        // Append to matching exercise group if ExerciseOrder is given (or already exists), otherwise append as a new exercise at the end.
        var matchingGroup = input.ExerciseOrder is int ord
            ? session.Sets.Where(s => s.ExerciseOrder == ord && s.ExerciseId == input.ExerciseId).OrderBy(s => s.SetNumber).ToList()
            : session.Sets.Where(s => s.ExerciseId == input.ExerciseId).OrderBy(s => s.ExerciseOrder).ThenBy(s => s.SetNumber).ToList();

        TrainingSessionSet newSet;
        if (matchingGroup.Count > 0)
        {
            if (matchingGroup.Count >= 15) return new(null, 400, "Maksymalnie 15 serii na ćwiczenie.");
            var template = matchingGroup[^1];
            newSet = new TrainingSessionSet
            {
                SessionId = session.Id,
                ExerciseId = exercise.Id,
                ProgramExerciseId = template.ProgramExerciseId,
                ExerciseOrder = template.ExerciseOrder,
                SetNumber = template.SetNumber + 1,
                TargetRepsMin = template.TargetRepsMin,
                TargetRepsMax = template.TargetRepsMax,
                TargetSeconds = template.TargetSeconds,
                TargetKg = template.TargetKg,
                RestSeconds = input.RestSeconds ?? template.RestSeconds,
                SupersetGroup = template.SupersetGroup,
                WeightKg = input.WeightKg ?? template.WeightKg,
                Reps = input.Reps ?? template.Reps,
                Seconds = input.Seconds ?? template.Seconds,
            };
        }
        else
        {
            var nextOrder = session.Sets.Count == 0 ? 0 : session.Sets.Max(s => s.ExerciseOrder) + 1;
            var lastMap = await LoadLastPerformanceAsync([exercise.Id], excludeSessionId: session.Id, ct);
            var prev = lastMap.TryGetValue(exercise.Id, out var lp) && lp.Sets.Count > 0 ? lp.Sets[0] : null;
            newSet = new TrainingSessionSet
            {
                SessionId = session.Id,
                ExerciseId = exercise.Id,
                ExerciseOrder = nextOrder,
                SetNumber = 1,
                TargetRepsMin = exercise.IsTimed ? null : 10,
                TargetRepsMax = exercise.IsTimed ? null : 12,
                TargetSeconds = exercise.IsTimed ? 30 : null,
                RestSeconds = input.RestSeconds ?? (exercise.IsTimed ? 45 : 75),
                WeightKg = input.WeightKg ?? (exercise.IsTimed ? null : prev?.WeightKg),
                Reps = input.Reps ?? (exercise.IsTimed ? null : (prev?.Reps ?? 10)),
                Seconds = input.Seconds ?? (exercise.IsTimed ? (prev?.Seconds ?? 30) : null),
            };
        }

        db.TrainingSessionSets.Add(newSet);
        await db.SaveChangesAsync(ct);
        return new(await GetDetailAsync(session.Id, ct), 201);
    }

    public async Task<ServiceResult<TrainingSessionDetailDto>> DeleteSetAsync(Guid sessionId, Guid setId, CancellationToken ct = default)
    {
        var session = await db.TrainingSessions
            .Include(s => s.Sets)
            .FirstOrDefaultAsync(s => s.Id == sessionId && s.PersonId == person.Id, ct);
        if (session is null) return new(null, 404, "Nie znaleziono sesji treningowej.");

        var set = session.Sets.FirstOrDefault(s => s.Id == setId);
        if (set is null) return new(null, 404, "Nie znaleziono serii.");

        var groupOrder = set.ExerciseOrder;
        db.TrainingSessionSets.Remove(set);
        session.Sets.Remove(set);

        // Renumber remaining sets in that exercise group sequentially (1..N)
        var seq = 1;
        foreach (var remaining in session.Sets.Where(s => s.ExerciseOrder == groupOrder).OrderBy(s => s.SetNumber))
            remaining.SetNumber = seq++;

        await db.SaveChangesAsync(ct);
        return new(await GetDetailAsync(session.Id, ct));
    }

    public async Task<ServiceResult<FinishSessionResultDto>> FinishAsync(Guid sessionId, FinishSessionInput input, CancellationToken ct = default)
    {
        var session = await db.TrainingSessions
            .Include(s => s.Sets).ThenInclude(set => set.Exercise)
            .Include(s => s.ProgramDay)
            .FirstOrDefaultAsync(s => s.Id == sessionId && s.PersonId == person.Id, ct);
        if (session is null) return new(null, 404, "Nie znaleziono sesji treningowej.");

        var now = DateTimeOffset.UtcNow;
        var elapsedMinutes = Math.Clamp((int)Math.Round(Math.Max(1, (now - session.StartedAt).TotalMinutes)), 1, 600);
        var duration = input.DurationMinutes ?? session.DurationMinutes ?? elapsedMinutes;
        if (duration is < 1 or > 600) return new(null, 400, "Czas treningu: 1–600 minut.");

        int? estimatedKcal;
        if (input.ClearEstimatedKcal == true) estimatedKcal = null;
        else if (input.EstimatedKcal is int k)
        {
            if (k is < 0 or > 5000) return new(null, 400, "Szacowane kcal: 0–5000.");
            estimatedKcal = k;
        }
        else estimatedKcal = session.EstimatedKcal ?? EstimateKcal(session.Kind, duration);

        if (input.Notes is not null)
        {
            var notes = input.Notes.Trim();
            if (notes.Length > 1000) return new(null, 400, "Notatka: maks. 1000 znaków.");
            session.Notes = notes;
        }

        session.FinishedAt ??= now;
        session.DurationMinutes = duration;
        session.EstimatedKcal = estimatedKcal;

        // Evaluate PRs against all earlier finished sessions for this person
        var exIds = session.Sets.Select(s => s.ExerciseId).Distinct().ToList();
        var priorSets = exIds.Count == 0
            ? new Dictionary<Guid, List<TrainingSessionSet>>()
            : (await db.TrainingSessionSets.AsNoTracking()
                .Include(s => s.Session)
                .Where(s => s.Session!.PersonId == person.Id
                    && s.SessionId != session.Id
                    && s.Session.FinishedAt != null
                    && s.Completed
                    && exIds.Contains(s.ExerciseId))
                .ToListAsync(ct))
              .GroupBy(s => s.ExerciseId)
              .ToDictionary(g => g.Key, g => g.ToList());

        var exercisesMap = session.Sets
            .Where(s => s.Exercise is not null)
            .GroupBy(s => s.ExerciseId)
            .ToDictionary(g => g.Key, g => g.First().Exercise!);

        var newPrs = EvaluateAndStampPrs(session.Sets, priorSets, exercisesMap);

        // Optional: propagate heaviest completed weights to future weeks of the same program day
        var updatedFutureTargets = 0;
        if (input.UpdateFutureTargets == true && session.ProgramId is Guid programId && session.ProgramDay is { } currentDay)
        {
            var maxWeightsByExercise = session.Sets
                .Where(s => s.Completed && s.WeightKg is > 0)
                .GroupBy(s => s.ExerciseId)
                .ToDictionary(g => g.Key, g => g.Max(s => s.WeightKg!.Value));

            if (maxWeightsByExercise.Count > 0)
            {
                var targetExIds = maxWeightsByExercise.Keys.ToList();
                var futureSlots = await db.ProgramExercises
                    .Include(pe => pe.Day)
                    .Where(pe => pe.Day!.ProgramId == programId
                        && pe.Day.Week > currentDay.Week
                        && pe.Day.Name == currentDay.Name
                        && targetExIds.Contains(pe.ExerciseId))
                    .ToListAsync(ct);

                foreach (var slot in futureSlots)
                {
                    var w = maxWeightsByExercise[slot.ExerciseId];
                    if (slot.TargetKg != w)
                    {
                        slot.TargetKg = w;
                        updatedFutureTargets++;
                    }
                }
                if (updatedFutureTargets > 0)
                {
                    var prog = await db.TrainingPrograms.FirstOrDefaultAsync(p => p.Id == programId && p.PersonId == person.Id, ct);
                    if (prog is not null) prog.UpdatedAt = now;
                }
            }
        }

        // Link / update Activity workout (auto-deduped by ActivityService against HealthConnect & Strava)
        var logActivity = input.LogActivity ?? true;
        var activityLinked = false;
        var dedupedWithWatch = false;

        if (logActivity)
        {
            Workout? workout = null;
            if (session.WorkoutId is Guid wid)
                workout = await db.Workouts.FirstOrDefaultAsync(w => w.Id == wid && w.PersonId == person.Id, ct);

            if (workout is null)
            {
                workout = CreateLinkedWorkout(session, session.ProgramDay?.WorkoutType, duration, estimatedKcal);
                db.Workouts.Add(workout);
                session.WorkoutId = workout.Id;
            }
            else
            {
                workout.Minutes = duration;
                workout.Kcal = estimatedKcal;
                workout.Type = WorkoutLabel(session, session.ProgramDay?.WorkoutType);
            }
            activityLinked = true;

            // Check whether watch/band data already covers this session window so UI can inform the user
            var dayFrom = session.Date.AddDays(-1);
            var dayTo = session.Date.AddDays(1);
            var watchWorkouts = await db.Workouts.AsNoTracking()
                .Where(w => w.PersonId == person.Id && w.Date >= dayFrom && w.Date <= dayTo
                    && (w.Source == MeasurementSource.HealthConnect || w.Source == MeasurementSource.Strava))
                .ToListAsync(ct);
            var activeSamples = await db.EnergySamples.AsNoTracking()
                .Where(e => e.PersonId == person.Id && e.Date == session.Date && e.Kind == EnergyKind.Active)
                .ToListAsync(ct);

            dedupedWithWatch = ActivityService.DuplicateOfWatch(workout, watchWorkouts)
                || ActivityService.BandKcal(workout, activeSamples) is not null;
        }
        else if (session.WorkoutId is Guid oldWid)
        {
            var oldW = await db.Workouts.FirstOrDefaultAsync(w => w.Id == oldWid && w.PersonId == person.Id && w.Source == MeasurementSource.Training, ct);
            if (oldW is not null) db.Workouts.Remove(oldW);
            session.WorkoutId = null;
        }

        await db.SaveChangesAsync(ct);

        var detail = await GetDetailAsync(session.Id, ct);
        return new(new FinishSessionResultDto(
            detail!, newPrs, detail!.TotalVolumeKg, detail.CompletedSets,
            updatedFutureTargets, activityLinked, dedupedWithWatch));
    }

    public async Task<bool> DeleteAsync(Guid sessionId, CancellationToken ct = default)
    {
        var session = await db.TrainingSessions
            .FirstOrDefaultAsync(s => s.Id == sessionId && s.PersonId == person.Id, ct);
        if (session is null) return false;

        if (session.WorkoutId is Guid wid)
        {
            var linked = await db.Workouts.FirstOrDefaultAsync(
                w => w.Id == wid && w.PersonId == person.Id && w.Source == MeasurementSource.Training, ct);
            if (linked is not null) db.Workouts.Remove(linked);
            session.WorkoutId = null;
        }

        db.TrainingSessions.Remove(session);
        await db.SaveChangesAsync(ct);
        return true;
    }

    // ---- Internal helpers ----

    private async Task<TrainingSessionDetailDto> BuildDetailDtoAsync(TrainingSession session, CancellationToken ct)
    {
        var exIds = session.Sets.Select(s => s.ExerciseId).Distinct().ToList();
        var lastMap = await LoadLastPerformanceAsync(exIds, excludeSessionId: session.Id, ct);

        var priorSets = exIds.Count == 0
            ? new Dictionary<Guid, List<TrainingSessionSet>>()
            : (await db.TrainingSessionSets.AsNoTracking()
                .Include(s => s.Session)
                .Where(s => s.Session!.PersonId == person.Id
                    && s.SessionId != session.Id
                    && s.Session.FinishedAt != null
                    && s.Completed
                    && exIds.Contains(s.ExerciseId))
                .ToListAsync(ct))
              .GroupBy(s => s.ExerciseId)
              .ToDictionary(g => g.Key, g => g.ToList());

        var hasFutureWeeks = false;
        if (session.ProgramId is Guid pid && session.ProgramDayId is Guid did)
        {
            var day = await db.ProgramDays.AsNoTracking().FirstOrDefaultAsync(d => d.Id == did, ct);
            if (day is not null)
            {
                hasFutureWeeks = await db.ProgramDays.AsNoTracking()
                    .AnyAsync(d => d.ProgramId == pid && d.Week > day.Week && d.Name == day.Name, ct);
            }
        }

        var groups = session.Sets
            .GroupBy(s => new { s.ExerciseOrder, s.ExerciseId })
            .OrderBy(g => g.Key.ExerciseOrder)
            .Select(g =>
            {
                var sets = g.OrderBy(s => s.SetNumber).ToList();
                var first = sets[0];
                var ex = first.Exercise;
                var isTimed = ex?.IsTimed == true || first.TargetSeconds is > 0;
                priorSets.TryGetValue(g.Key.ExerciseId, out var priorForEx);
                var baseline = priorForEx is null ? null : ComputeBaseline(priorForEx, isTimed);
                lastMap.TryGetValue(g.Key.ExerciseId, out var lastPerf);

                return new SessionExerciseGroupDto(
                    g.Key.ExerciseOrder,
                    g.Key.ExerciseId,
                    ex is null ? "Ćwiczenie" : ExerciseCatalog.DisplayName(ex),
                    ex?.NameEn ?? "",
                    ex is null ? "other" : ExerciseTokens.Of(ex.Equipment),
                    ex is null ? [] : ExerciseTokens.MuscleTokens(ex.PrimaryMuscles),
                    isTimed,
                    ex?.YoutubeId is not null,
                    ex is not null && ex.ImagePaths.Count > 0 ? ExerciseEndpoints.ImageUrl(ex.Id, 0) : null,
                    first.RestSeconds,
                    first.SupersetGroup,
                    lastPerf,
                    baseline,
                    sets.Select(ToSetDto).ToList());
            })
            .ToList();

        var completedSets = session.Sets.Count(s => s.Completed);
        var volume = SessionVolume(session.Sets);
        var prCount = session.Sets.Count(s => s.IsPr);

        return new TrainingSessionDetailDto(
            session.Id, session.ProgramId, session.ProgramDayId, session.Name,
            ExerciseTokens.Of(session.Kind), session.Date, session.StartedAt, session.FinishedAt,
            session.DurationMinutes, session.EstimatedKcal, session.Notes, session.WorkoutId,
            hasFutureWeeks, completedSets, session.Sets.Count, volume, prCount, groups);
    }

    private async Task<Dictionary<Guid, ExerciseLastPerformanceDto>> LoadLastPerformanceAsync(
        IReadOnlyCollection<Guid> exerciseIds, Guid? excludeSessionId, CancellationToken ct)
    {
        if (exerciseIds.Count == 0) return [];
        var rows = await db.TrainingSessionSets.AsNoTracking()
            .Include(s => s.Session)
            .Where(s => s.Session!.PersonId == person.Id
                && s.Session.FinishedAt != null
                && s.Completed
                && exerciseIds.Contains(s.ExerciseId)
                && (excludeSessionId == null || s.SessionId != excludeSessionId.Value))
            .ToListAsync(ct);

        var result = new Dictionary<Guid, ExerciseLastPerformanceDto>();
        foreach (var byEx in rows.GroupBy(r => r.ExerciseId))
        {
            var latestSession = byEx
                .GroupBy(r => r.SessionId)
                .OrderByDescending(g => g.First().Session!.Date)
                .ThenByDescending(g => g.First().Session!.FinishedAt)
                .First();
            var date = latestSession.First().Session!.Date;
            var sets = latestSession
                .OrderBy(s => s.SetNumber)
                .Select(s => new LastSetSnapshotDto(s.WeightKg, s.Reps, s.Seconds))
                .ToList();
            result[byEx.Key] = new ExerciseLastPerformanceDto(date, sets);
        }
        return result;
    }

    private Workout CreateLinkedWorkout(TrainingSession session, string? workoutType, int minutes, int? kcal) => new()
    {
        PersonId = person.Id,
        Date = session.Date,
        StartedAt = session.StartedAt,
        Minutes = minutes,
        Kcal = kcal,
        Type = WorkoutLabel(session, workoutType),
        Source = MeasurementSource.Training,
        ExternalKey = $"training:{session.Id}",
    };

    private static string WorkoutLabel(TrainingSession session, string? workoutType)
    {
        var raw = session.Kind == ProgramDayKind.FollowAlong && !string.IsNullOrWhiteSpace(workoutType)
            ? workoutType.Trim()
            : !string.IsNullOrWhiteSpace(session.Name) ? session.Name.Trim() : "Trening siłowy";
        return raw.Length <= 60 ? raw : raw[..60].TrimEnd();
    }

    public static TrainingSessionSummaryDto ToSummary(TrainingSession s) => new(
        s.Id, s.ProgramId, s.ProgramDayId, s.Name, ExerciseTokens.Of(s.Kind), s.Date,
        s.StartedAt, s.FinishedAt, s.DurationMinutes, s.EstimatedKcal,
        s.Sets.Select(x => x.ExerciseOrder).Distinct().Count(),
        s.Sets.Count, s.Sets.Count(x => x.Completed),
        SessionVolume(s.Sets), s.Sets.Count(x => x.IsPr),
        s.Notes, s.WorkoutId);

    private static SessionSetDto ToSetDto(TrainingSessionSet s) => new(
        s.Id, s.SetNumber, s.TargetRepsMin, s.TargetRepsMax, s.TargetSeconds,
        s.TargetKg, s.RestSeconds, s.Reps, s.Seconds, s.WeightKg,
        s.Completed, s.CompletedAt, s.Notes, s.IsPr);
}
