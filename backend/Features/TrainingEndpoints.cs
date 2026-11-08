using Microsoft.EntityFrameworkCore;
using Mise.Api.Data;
using Mise.Api.Domain;
using Mise.Api.Services;
using Mise.Api.Services.Training;

namespace Mise.Api.Features;

/// <summary>
/// Per-person training: the questionnaire, programs (weeks → days → exercises) and "today".
/// Private, reads included — /api/training is in ApiAccessMiddleware's private list — and every
/// query is scoped to <see cref="PersonScope"/>, including lookups by id.
/// </summary>
public static class TrainingEndpoints
{
    public static RouteGroupBuilder MapTraining(this RouteGroupBuilder api)
    {
        var g = api.MapGroup("/training").WithTags("Training");

        // ---- profile (questionnaire) ----

        g.MapGet("/profile", async (MiseDbContext db, PersonScope person) =>
            Results.Ok(ToDto(await db.TrainingProfiles.AsNoTracking().FirstOrDefaultAsync(x => x.PersonId == person.Id))));

        g.MapPut("/profile", async (TrainingProfileInput input, MiseDbContext db, PersonScope person) =>
        {
            var p = await db.TrainingProfiles.FirstOrDefaultAsync(x => x.PersonId == person.Id);
            var isNew = p is null;
            p ??= new TrainingProfile { PersonId = person.Id };
            if (TrainingRules.ApplyProfile(p, input) is { } error) return Results.BadRequest(new { error });
            if (isNew) db.TrainingProfiles.Add(p);
            await db.SaveChangesAsync();
            return Results.Ok(ToDto(p));
        });

        // ---- programs ----

        g.MapGet("/program", async (MiseDbContext db, PersonScope person) =>
            await LoadAsync(db, person).FirstOrDefaultAsync(x => x.Status == ProgramStatus.Active) is { } p
                ? Results.Ok(ToDto(p))
                : Results.NoContent());

        g.MapGet("/programs", async (MiseDbContext db, PersonScope person) =>
        {
            var list = await db.TrainingPrograms.AsNoTracking().Include(x => x.Days)
                .Where(x => x.PersonId == person.Id)
                .OrderByDescending(x => x.Status == ProgramStatus.Active).ThenByDescending(x => x.UpdatedAt)
                .ToListAsync();
            return Results.Ok(list.Select(ToSummary).ToList());
        });

        g.MapGet("/programs/{id:guid}", async (Guid id, MiseDbContext db, PersonScope person) =>
            await LoadAsync(db, person).FirstOrDefaultAsync(x => x.Id == id) is { } p
                ? Results.Ok(ToDto(p))
                : Results.NotFound());

        g.MapPost("/programs", async (TrainingProgramInput input, MiseDbContext db, PersonScope person,
            YouTubeVerifier youtube, CancellationToken ct) =>
        {
            var p = new TrainingProgram { PersonId = person.Id };
            if (await BuildAsync(p, input, db, youtube, ct) is { } error) return Results.BadRequest(new { error });
            await using var tx = await db.Database.BeginTransactionAsync(ct);
            db.TrainingPrograms.Add(p);
            if (input.Activate == true) await ActivateAsync(db, p, ct);
            await db.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);
            return Results.Created($"/api/training/programs/{p.Id}", ToDto(p));
        });

        g.MapPut("/programs/{id:guid}", async (Guid id, TrainingProgramInput input, MiseDbContext db,
            PersonScope person, YouTubeVerifier youtube, CancellationToken ct) =>
        {
            var p = await db.TrainingPrograms.Include(x => x.Days).ThenInclude(d => d.Exercises)
                .FirstOrDefaultAsync(x => x.Id == id && x.PersonId == person.Id, ct);
            if (p is null) return Results.NotFound();
            var old = p.Days.ToList();
            if (await BuildAsync(p, input, db, youtube, ct) is { } error) return Results.BadRequest(new { error });
            var fresh = p.Days;
            await using var tx = await db.Database.BeginTransactionAsync(ct);
            // Delete the old days first: the new ones reuse their (week, weekday) unique keys.
            p.Days = old;
            db.ProgramDays.RemoveRange(old);
            await db.SaveChangesAsync(ct);
            foreach (var d in fresh) { d.ProgramId = p.Id; db.ProgramDays.Add(d); }
            if (input.Activate == true) await ActivateAsync(db, p, ct);
            await db.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);
            return Results.Ok(ToDto(await LoadAsync(db, person).FirstAsync(x => x.Id == id, ct)));
        });

        g.MapPatch("/programs/{id:guid}", async (Guid id, TrainingProgramPatch input, MiseDbContext db,
            PersonScope person, CancellationToken ct) =>
        {
            var p = await db.TrainingPrograms.Include(x => x.Days)
                .FirstOrDefaultAsync(x => x.Id == id && x.PersonId == person.Id, ct);
            if (p is null) return Results.NotFound();
            await using var tx = await db.Database.BeginTransactionAsync(ct);
            if (input.Name is not null)
            {
                var name = input.Name.Trim();
                if (name.Length is 0 or > 120) return Results.BadRequest(new { error = "name: 1–120 znaków." });
                p.Name = name;
            }
            if (input.Description is not null) p.Description = input.Description.Trim();
            if (input.Rationale is not null) p.Rationale = input.Rationale.Trim();
            if (input.StartDate is { } start)
            {
                // Days keep their (week, weekday); a later start may push week-1 days before it.
                if (p.Days.Any(d => ProgramSchedule.DateOf(start, d.Week, d.Weekday) < start))
                    return Results.BadRequest(new { error = "Nowa data startu wypada po niektórych dniach 1. tygodnia — wybierz poniedziałek lub wcześniej." });
                p.StartDate = start;
            }
            if (input.Status is not null)
            {
                if (!ExerciseTokens.TryParse<ProgramStatus>(input.Status, out var status))
                    return Results.BadRequest(new { error = "status: active, draft albo archived." });
                if (status == ProgramStatus.Active) await ActivateAsync(db, p, ct);
                else p.Status = status;
            }
            p.UpdatedAt = DateTimeOffset.UtcNow;
            await db.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);
            return Results.Ok(ToDto(await LoadAsync(db, person).FirstAsync(x => x.Id == id, ct)));
        });

        g.MapDelete("/programs/{id:guid}", async (Guid id, MiseDbContext db, PersonScope person) =>
        {
            var p = await db.TrainingPrograms.FirstOrDefaultAsync(x => x.Id == id && x.PersonId == person.Id);
            if (p is null) return Results.NotFound();
            db.TrainingPrograms.Remove(p);
            await db.SaveChangesAsync();
            return Results.NoContent();
        });

        // ---- days ----

        g.MapPost("/programs/{id:guid}/days", async (Guid id, ProgramDayInput input, MiseDbContext db,
            PersonScope person, YouTubeVerifier youtube, CancellationToken ct) =>
        {
            var p = await db.TrainingPrograms.Include(x => x.Days)
                .FirstOrDefaultAsync(x => x.Id == id && x.PersonId == person.Id, ct);
            if (p is null) return Results.NotFound();
            if (p.Days.Any(d => d.Week == input.Week && d.Weekday == input.Weekday))
                return Results.Conflict(new { error = $"{TrainingRules.Where(input.Week, input.Weekday)}: ten dzień już ma trening." });
            var (day, error) = await BuildDayAsync(p, input, db, youtube, ct);
            if (day is null) return Results.BadRequest(new { error });
            day.ProgramId = p.Id;
            db.ProgramDays.Add(day);
            p.UpdatedAt = DateTimeOffset.UtcNow;
            await db.SaveChangesAsync(ct);
            return Results.Ok(ToDto(await LoadAsync(db, person).FirstAsync(x => x.Id == id, ct)));
        });

        g.MapPut("/programs/{id:guid}/days/{dayId:guid}", async (Guid id, Guid dayId, ProgramDayInput input,
            MiseDbContext db, PersonScope person, YouTubeVerifier youtube, CancellationToken ct) =>
        {
            var p = await db.TrainingPrograms.Include(x => x.Days).ThenInclude(d => d.Exercises)
                .FirstOrDefaultAsync(x => x.Id == id && x.PersonId == person.Id, ct);
            var old = p?.Days.FirstOrDefault(d => d.Id == dayId);
            if (p is null || old is null) return Results.NotFound();
            if (p.Days.Any(d => d.Id != dayId && d.Week == input.Week && d.Weekday == input.Weekday))
                return Results.Conflict(new { error = $"{TrainingRules.Where(input.Week, input.Weekday)}: ten dzień już ma trening." });
            var (day, error) = await BuildDayAsync(p, input, db, youtube, ct);
            if (day is null) return Results.BadRequest(new { error });
            // Replace in place: keep the day id (links from sessions later), swap the slots.
            old.Week = day.Week;
            old.Weekday = day.Weekday;
            old.Name = day.Name;
            old.Kind = day.Kind;
            old.Location = day.Location;
            old.Notes = day.Notes;
            old.VideoYoutubeId = day.VideoYoutubeId;
            old.VideoTitle = day.VideoTitle;
            old.VideoMinutes = day.VideoMinutes;
            old.WorkoutType = day.WorkoutType;
            db.ProgramExercises.RemoveRange(old.Exercises);
            foreach (var slot in day.Exercises)
            {
                slot.ProgramDayId = old.Id;
                db.ProgramExercises.Add(slot);
            }
            p.UpdatedAt = DateTimeOffset.UtcNow;
            await db.SaveChangesAsync(ct);
            return Results.Ok(ToDto(await LoadAsync(db, person).FirstAsync(x => x.Id == id, ct)));
        });

        g.MapDelete("/programs/{id:guid}/days/{dayId:guid}", async (Guid id, Guid dayId, MiseDbContext db, PersonScope person) =>
        {
            var day = await db.ProgramDays.Include(d => d.Program)
                .FirstOrDefaultAsync(d => d.Id == dayId && d.ProgramId == id && d.Program!.PersonId == person.Id);
            if (day is null) return Results.NotFound();
            day.Program!.UpdatedAt = DateTimeOffset.UtcNow;
            db.ProgramDays.Remove(day);
            await db.SaveChangesAsync();
            return Results.NoContent();
        });

        // ---- one exercise slot: targets or a swap ----

        g.MapPatch("/program-exercises/{id:guid}", async (Guid id, ProgramExercisePatch input, MiseDbContext db,
            PersonScope person, CancellationToken ct) =>
        {
            var slot = await db.ProgramExercises.Include(x => x.Exercise).Include(x => x.Day).ThenInclude(d => d!.Program)
                .FirstOrDefaultAsync(x => x.Id == id && x.Day!.Program!.PersonId == person.Id, ct);
            if (slot is null) return Results.NotFound();
            var program = slot.Day!.Program!;

            var exercise = slot.Exercise!;
            if (input.ExerciseId is { } newId && newId != slot.ExerciseId)
            {
                exercise = await db.Exercises.FirstOrDefaultAsync(x => x.Id == newId, ct);
                if (exercise is null) return Results.BadRequest(new { error = "Nie ma takiego ćwiczenia w katalogu." });
            }
            // A swap to/from a timed exercise flips reps ↔ seconds unless the caller set them.
            var switchesMode = exercise.IsTimed != slot.Exercise!.IsTimed && input.Seconds is null && input.RepsMin is null && input.RepsMax is null;
            var (repsMin, repsMax, seconds) = switchesMode
                ? exercise.IsTimed ? ((int?)null, (int?)null, (int?)30) : (10, 12, null)
                : (input.RepsMin ?? (input.Seconds is not null ? null : slot.RepsMin),
                   input.RepsMax ?? (input.Seconds is not null ? null : slot.RepsMax),
                   input.Seconds ?? (input.RepsMin is not null || input.RepsMax is not null ? null : slot.Seconds));
            var error = TrainingRules.ApplyTargets(slot, input.Sets ?? slot.Sets, repsMin, repsMax, seconds,
                input.RestSeconds ?? slot.RestSeconds,
                input.ClearTargetKg == true ? null : input.TargetKg ?? (switchesMode || exercise.Id != slot.ExerciseId ? null : slot.TargetKg),
                input.Notes ?? slot.Notes, slot.SupersetGroup, exercise.IsTimed);
            if (error is not null) return Results.BadRequest(new { error });

            var swapped = 0;
            if (exercise.Id != slot.ExerciseId)
            {
                var oldId = slot.ExerciseId;
                slot.ExerciseId = exercise.Id;
                slot.Exercise = exercise;
                swapped = 1;
                if (input.ApplyToFollowingWeeks == true)
                {
                    var (programId, week, dayName) = (program.Id, slot.Day.Week, slot.Day.Name);
                    var later = await db.ProgramExercises.Include(x => x.Day)
                        .Where(x => x.Day!.ProgramId == programId && x.Day.Week > week
                            && x.Day.Name == dayName && x.ExerciseId == oldId)
                        .ToListAsync(ct);
                    foreach (var other in later)
                    {
                        other.ExerciseId = exercise.Id;
                        // Same weight makes no sense on a different movement; reps carry over.
                        other.TargetKg = null;
                        if (switchesMode)
                            (other.RepsMin, other.RepsMax, other.Seconds) = exercise.IsTimed
                                ? ((int?)null, (int?)null, (int?)30)
                                : (10, 12, null);
                    }
                    swapped += later.Count;
                }
            }
            program.UpdatedAt = DateTimeOffset.UtcNow;
            await db.SaveChangesAsync(ct);
            return Results.Ok(new { swapped, program = ToDto(await LoadAsync(db, person).FirstAsync(x => x.Id == program.Id, ct)) });
        });

        // ---- today ----

        g.MapGet("/today", async (DateOnly? date, MiseDbContext db, PersonScope person) =>
        {
            var day = date ?? DateOnly.FromDateTime(DateTime.Today);
            var p = await LoadAsync(db, person).FirstOrDefaultAsync(x => x.Status == ProgramStatus.Active);
            if (p is null) return Results.Ok(new TrainingTodayDto(day, "none", null, null, null, null));
            var t = ProgramSchedule.Resolve(p, day);
            var status = t.State switch
            {
                ProgramSchedule.State.BeforeStart => "before-start",
                ProgramSchedule.State.Scheduled => "scheduled",
                ProgramSchedule.State.Rest => "rest",
                _ => "finished",
            };
            return Results.Ok(new TrainingTodayDto(day, status, ToSummary(p), t.Week,
                t.Day is null ? null : ToDto(p, t.Day), t.Next is null ? null : ToDto(p, t.Next)));
        });

        return api;
    }

    // ---- helpers ----

    private static IQueryable<TrainingProgram> LoadAsync(MiseDbContext db, PersonScope person)
        => db.TrainingPrograms.AsNoTracking().AsSplitQuery()
            .Include(x => x.Days).ThenInclude(d => d.Exercises).ThenInclude(e => e.Exercise)
            .Where(x => x.PersonId == person.Id);

    /// <summary>Header + days from input; verifies follow-along videos. Leaves <paramref name="p"/>.Days set to the new days.</summary>
    private static async Task<string?> BuildAsync(TrainingProgram p, TrainingProgramInput input, MiseDbContext db,
        YouTubeVerifier youtube, CancellationToken ct)
    {
        if (TrainingRules.ApplyHeader(p, input, DateOnly.FromDateTime(DateTime.Today)) is { } error) return error;
        var inputs = input.Days ?? [];
        var catalog = await CatalogForAsync(db, inputs, ct);
        if (TrainingRules.BuildDays(p, inputs, catalog, out var days) is { } dayError) return dayError;
        if (await VerifyVideosAsync(days, youtube, ct) is { } videoError) return videoError;
        p.Days = days;
        return null;
    }

    private static async Task<(ProgramDay? Day, string? Error)> BuildDayAsync(TrainingProgram p, ProgramDayInput input,
        MiseDbContext db, YouTubeVerifier youtube, CancellationToken ct)
    {
        var catalog = await CatalogForAsync(db, [input], ct);
        if (TrainingRules.BuildDay(p, input, catalog, out var day) is { } error) return (null, error);
        if (await VerifyVideosAsync([day!], youtube, ct) is { } videoError) return (null, videoError);
        return (day, null);
    }

    private static async Task<IReadOnlyDictionary<Guid, Exercise>> CatalogForAsync(MiseDbContext db,
        IEnumerable<ProgramDayInput> days, CancellationToken ct)
    {
        var ids = days.SelectMany(d => d.Exercises ?? []).Select(e => e.ExerciseId).Distinct().ToList();
        return await db.Exercises.Where(e => ids.Contains(e.Id)).ToDictionaryAsync(e => e.Id, ct);
    }

    private static async Task<string?> VerifyVideosAsync(IEnumerable<ProgramDay> days, YouTubeVerifier youtube,
        CancellationToken ct)
    {
        var verified = new Dictionary<string, YouTubeVerifier.Result>();
        foreach (var day in days.Where(d => d.Kind == ProgramDayKind.FollowAlong))
        {
            var id = day.VideoYoutubeId!;
            if (!verified.TryGetValue(id, out var result))
                verified[id] = result = await youtube.VerifyAsync(id, ct);
            if (!result.Ok) return $"{TrainingRules.Where(day.Week, day.Weekday)}: {result.Error}";
            day.VideoTitle = result.Title;
        }
        return null;
    }

    /// <summary>Makes <paramref name="p"/> the person's only active program (others → archived).</summary>
    private static async Task ActivateAsync(MiseDbContext db, TrainingProgram p, CancellationToken ct)
    {
        var others = await db.TrainingPrograms
            .Where(x => x.PersonId == p.PersonId && x.Id != p.Id && x.Status == ProgramStatus.Active)
            .ToListAsync(ct);
        foreach (var o in others) o.Status = ProgramStatus.Archived;
        // Archive first in its own save so the partial unique index never sees two actives.
        if (others.Count > 0) await db.SaveChangesAsync(ct);
        p.Status = ProgramStatus.Active;
    }

    public static TrainingProfileDto ToDto(TrainingProfile? p)
    {
        p ??= new TrainingProfile();
        var configured = p.PersonId != 0;
        return new(configured, ExerciseTokens.Of(p.Goal), ExerciseTokens.Of(p.Level), p.DaysPerWeek,
            p.MinutesPerSession, p.PreferredWeekdays, ExerciseTokens.Of(p.Location),
            p.HomeEquipment.Select(n => Enum.TryParse<ExerciseEquipment>(n, out var e) ? ExerciseTokens.Of(e) : null)
                .OfType<string>().ToList(),
            p.Styles, p.Limitations, p.Dislikes, p.Notes, configured ? p.UpdatedAt : null);
    }

    public static TrainingProgramSummaryDto ToSummary(TrainingProgram p) => new(p.Id, p.Name, p.StartDate,
        ProgramSchedule.EndDate(p), p.Weeks, ExerciseTokens.Of(p.Status), p.CreatedBy, p.Days.Count, p.UpdatedAt);

    public static TrainingProgramDto ToDto(TrainingProgram p) => new(p.Id, p.Name, p.Description, p.Rationale,
        p.StartDate, ProgramSchedule.EndDate(p), p.Weeks, ExerciseTokens.Of(p.Status), p.CreatedBy, p.CreatedAt,
        p.UpdatedAt, p.Days.OrderBy(d => d.Week).ThenBy(d => d.Weekday).Select(d => ToDto(p, d)).ToList());

    public static ProgramDayDto ToDto(TrainingProgram p, ProgramDay d) => new(d.Id, d.Week, d.Weekday,
        ProgramSchedule.DateOf(p, d), d.Name, ExerciseTokens.Of(d.Kind), ExerciseTokens.Of(d.Location), d.Notes,
        d.VideoYoutubeId is null ? null : new ProgramVideoDto(d.VideoYoutubeId, d.VideoTitle, d.VideoMinutes, d.WorkoutType),
        d.Exercises.OrderBy(e => e.Order).Select(ToDto).ToList());

    public static ProgramExerciseDto ToDto(ProgramExercise s)
    {
        var e = s.Exercise!;
        return new(s.Id, s.Order, s.ExerciseId, ExerciseCatalog.DisplayName(e), e.NameEn, ExerciseTokens.Of(e.Equipment),
            ExerciseTokens.MuscleTokens(e.PrimaryMuscles), e.IsTimed, e.YoutubeId is not null,
            e.ImagePaths.Count > 0 ? ExerciseEndpoints.ImageUrl(e.Id, 0) : null,
            s.Sets, s.RepsMin, s.RepsMax, s.Seconds, s.RestSeconds, s.TargetKg, s.Notes, s.SupersetGroup);
    }
}
