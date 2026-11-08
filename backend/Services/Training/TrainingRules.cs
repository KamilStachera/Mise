using Mise.Api.Domain;
using Mise.Api.Features;

namespace Mise.Api.Services.Training;

/// <summary>
/// Validation for the training questionnaire and programs. Builders return a new entity or a
/// Polish error naming the offending day ("Tydzień 2, wtorek: …") so agents can fix one spot.
/// Nothing here touches the database; exercise ids are checked against a supplied catalog.
/// </summary>
public static class TrainingRules
{
    public static readonly string[] Styles = ["strength", "pilates", "yoga", "hiit", "stretching", "cardio"];
    public static readonly string[] WeekdayNames = ["poniedziałek", "wtorek", "środa", "czwartek", "piątek", "sobota", "niedziela"];

    public const int MaxWeeks = 26;
    public const int MaxExercisesPerDay = 20;

    // ---- profile ----

    public static string? ApplyProfile(TrainingProfile p, TrainingProfileInput input)
    {
        var goal = p.Goal;
        if (input.Goal is not null && !ExerciseTokens.TryParse(input.Goal, out goal))
            return Allowed("goal", ExerciseTokens.All<TrainingGoal>());
        var level = p.Level;
        if (input.Level is not null && !ExerciseTokens.TryParse(input.Level, out level))
            return Allowed("level", ExerciseTokens.All<ExerciseLevel>());
        var location = p.Location;
        if (input.Location is not null && !ExerciseTokens.TryParse(input.Location, out location))
            return Allowed("location", ExerciseTokens.All<TrainingLocation>());
        if (input.DaysPerWeek is < 1 or > 7) return "daysPerWeek: 1–7.";
        if (input.MinutesPerSession is < 10 or > 180) return "minutesPerSession: 10–180.";
        if (input.PreferredWeekdays is < 0 or > 0b1111111) return "preferredWeekdays: maska bitowa 0–127 (bit 0 = poniedziałek).";

        var equipment = p.HomeEquipment;
        if (input.HomeEquipment is not null)
        {
            equipment = [];
            foreach (var t in input.HomeEquipment)
            {
                if (!ExerciseTokens.TryParse<ExerciseEquipment>(t, out var e))
                    return Allowed("homeEquipment", ExerciseTokens.All<ExerciseEquipment>());
                if (e != ExerciseEquipment.BodyOnly && !equipment.Contains(e.ToString())) equipment.Add(e.ToString());
            }
        }
        var styles = p.Styles;
        if (input.Styles is not null)
        {
            styles = input.Styles.Select(s => s.Trim().ToLowerInvariant()).Distinct().ToList();
            if (styles.Any(s => !Styles.Contains(s))) return Allowed("styles", Styles);
        }
        foreach (var (text, field) in new[] { (input.Limitations, "limitations"), (input.Dislikes, "dislikes"), (input.Notes, "notes") })
            if (text?.Length > 1000) return $"{field}: maks. 1000 znaków.";

        p.Goal = goal;
        p.Level = level;
        p.Location = location;
        p.DaysPerWeek = input.DaysPerWeek ?? p.DaysPerWeek;
        p.MinutesPerSession = input.MinutesPerSession ?? p.MinutesPerSession;
        p.PreferredWeekdays = input.PreferredWeekdays ?? p.PreferredWeekdays;
        p.HomeEquipment = equipment;
        p.Styles = styles;
        p.Limitations = input.Limitations?.Trim() ?? p.Limitations;
        p.Dislikes = input.Dislikes?.Trim() ?? p.Dislikes;
        p.Notes = input.Notes?.Trim() ?? p.Notes;
        p.UpdatedAt = DateTimeOffset.UtcNow;
        return null;
    }

    // ---- program ----

    /// <summary>Header fields of a new/replaced program (days are built separately).</summary>
    public static string? ApplyHeader(TrainingProgram p, TrainingProgramInput input, DateOnly today)
    {
        var name = input.Name?.Trim() ?? "";
        if (name.Length is 0 or > 120) return "name: 1–120 znaków.";
        if (input.Description?.Length > 1000) return "description: maks. 1000 znaków.";
        if (input.Rationale?.Length > 4000) return "rationale: maks. 4000 znaków.";
        var weeks = input.Weeks ?? 4;
        if (weeks is < 1 or > MaxWeeks) return $"weeks: 1–{MaxWeeks}.";
        var start = input.StartDate ?? ProgramSchedule.MondayOf(today).AddDays(today == ProgramSchedule.MondayOf(today) ? 0 : 7);
        if (start < today.AddYears(-1) || start > today.AddYears(1)) return "startDate: najwyżej rok od dziś.";
        var createdBy = input.CreatedBy?.Trim().ToLowerInvariant() ?? "manual";
        if (createdBy is not ("ai" or "manual")) return "createdBy: ai albo manual.";

        p.Name = name;
        p.Description = input.Description?.Trim() ?? "";
        p.Rationale = input.Rationale?.Trim() ?? "";
        p.StartDate = start;
        p.Weeks = weeks;
        p.CreatedBy = createdBy;
        p.UpdatedAt = DateTimeOffset.UtcNow;
        return null;
    }

    /// <summary>All days of a program; checks the (week, weekday) grid and start date.</summary>
    public static string? BuildDays(TrainingProgram p, IReadOnlyList<ProgramDayInput> inputs,
        IReadOnlyDictionary<Guid, Exercise> catalog, out List<ProgramDay> days)
    {
        days = [];
        if (inputs.Count > p.Weeks * 7) return "Za dużo dni jak na liczbę tygodni.";
        var seen = new HashSet<(int, int)>();
        foreach (var input in inputs)
        {
            if (BuildDay(p, input, catalog, out var day) is { } error) return error;
            if (!seen.Add((day!.Week, day.Weekday)))
                return $"{Where(input.Week, input.Weekday)}: dwa treningi tego samego dnia — połącz je w jeden.";
            days.Add(day);
        }
        return null;
    }

    public static string? BuildDay(TrainingProgram p, ProgramDayInput input, IReadOnlyDictionary<Guid, Exercise> catalog,
        out ProgramDay? day)
    {
        day = null;
        var where = Where(input.Week, input.Weekday);
        if (input.Week < 1 || input.Week > p.Weeks) return $"{where}: tydzień poza zakresem 1–{p.Weeks}.";
        if (input.Weekday is < 0 or > 6) return $"{where}: weekday 0–6 (0 = poniedziałek).";
        if (ProgramSchedule.DateOf(p.StartDate, input.Week, input.Weekday) < p.StartDate)
            return $"{where}: dzień przed datą startu planu ({p.StartDate:yyyy-MM-dd}).";
        var name = input.Name?.Trim() ?? "";
        if (name.Length is 0 or > 120) return $"{where}: name 1–120 znaków.";
        if (input.Notes?.Length > 1000) return $"{where}: notes maks. 1000 znaków.";

        var kind = ProgramDayKind.Exercises;
        if (input.Kind is not null && !ExerciseTokens.TryParse(input.Kind, out kind))
            return $"{where}: {Allowed("kind", ExerciseTokens.All<ProgramDayKind>())}";
        var location = TrainingLocation.Any;
        if (input.Location is not null && !ExerciseTokens.TryParse(input.Location, out location))
            return $"{where}: {Allowed("location", ExerciseTokens.All<TrainingLocation>())}";

        day = new ProgramDay
        {
            Week = input.Week,
            Weekday = input.Weekday,
            Name = name,
            Kind = kind,
            Location = location,
            Notes = input.Notes?.Trim() ?? "",
        };

        if (kind == ProgramDayKind.FollowAlong)
        {
            if (YouTubeVerifier.ExtractId(input.VideoYoutubeId) is not { } videoId)
                return $"{where}: trening z filmem wymaga videoYoutubeId (link lub id YouTube).";
            if (input.VideoMinutes is < 1 or > 240) return $"{where}: videoMinutes 1–240.";
            if (input.WorkoutType?.Length > 60) return $"{where}: workoutType maks. 60 znaków.";
            day.VideoYoutubeId = videoId;
            day.VideoMinutes = input.VideoMinutes;
            day.WorkoutType = string.IsNullOrWhiteSpace(input.WorkoutType) ? null : input.WorkoutType.Trim();
            if (input.Exercises is { Count: > 0 }) return $"{where}: trening z filmem nie ma listy ćwiczeń.";
            return null;
        }

        var exercises = input.Exercises ?? [];
        if (exercises.Count == 0) return $"{where}: dzień bez ćwiczeń (albo ustaw kind: follow-along).";
        if (exercises.Count > MaxExercisesPerDay) return $"{where}: maks. {MaxExercisesPerDay} ćwiczeń.";
        for (var i = 0; i < exercises.Count; i++)
        {
            if (BuildExercise(exercises[i], catalog, out var slot) is { } error)
                return $"{where}, ćwiczenie {i + 1}: {error}";
            slot!.Order = i;
            day.Exercises.Add(slot);
        }
        return null;
    }

    public static string? BuildExercise(ProgramExerciseInput input, IReadOnlyDictionary<Guid, Exercise> catalog,
        out ProgramExercise? slot)
    {
        slot = null;
        if (!catalog.TryGetValue(input.ExerciseId, out var ex))
            return $"nie ma ćwiczenia {input.ExerciseId} w katalogu (użyj id z search_exercises).";
        slot = new ProgramExercise { ExerciseId = ex.Id, Exercise = ex };
        return ApplyTargets(slot, input.Sets ?? 3, input.RepsMin, input.RepsMax, input.Seconds,
            input.RestSeconds ?? (ex.IsTimed ? 45 : 75), input.TargetKg, input.Notes, input.SupersetGroup, ex.IsTimed);
    }

    /// <summary>
    /// Targets for one slot. Reps: a range (or one bound = fixed reps); timed: seconds. When the
    /// input gives neither, timed exercises default to 30 s and others to 10–12 reps.
    /// </summary>
    public static string? ApplyTargets(ProgramExercise slot, int sets, int? repsMin, int? repsMax, int? seconds,
        int rest, decimal? targetKg, string? notes, string? superset, bool timedByDefault)
    {
        if (sets is < 1 or > 10) return "sets 1–10.";
        if (repsMin is < 1 or > 100 || repsMax is < 1 or > 100) return "powtórzenia 1–100.";
        if (repsMin is { } lo && repsMax is { } hi && lo > hi) return "repsMin większe niż repsMax.";
        if (seconds is < 5 or > 900) return "seconds 5–900.";
        if ((repsMin ?? repsMax) is not null && seconds is not null) return "podaj powtórzenia ALBO seconds, nie oba.";
        if (rest is < 0 or > 600) return "restSeconds 0–600.";
        if (targetKg is < 0 or > 500) return "targetKg 0–500.";
        if (notes?.Length > 300) return "notes maks. 300 znaków.";
        if (superset?.Trim().Length > 8) return "supersetGroup maks. 8 znaków (np. \"A\").";

        if ((repsMin ?? repsMax) is null && seconds is null)
        {
            if (timedByDefault) seconds = 30;
            else (repsMin, repsMax) = (10, 12);
        }
        slot.Sets = sets;
        slot.RepsMin = repsMin ?? repsMax;
        slot.RepsMax = repsMax ?? repsMin;
        slot.Seconds = seconds;
        slot.RestSeconds = rest;
        slot.TargetKg = targetKg;
        slot.Notes = notes?.Trim() ?? "";
        slot.SupersetGroup = string.IsNullOrWhiteSpace(superset) ? null : superset.Trim().ToUpperInvariant();
        return null;
    }

    public static string Where(int week, int weekday)
        => $"Tydzień {week}, {(weekday is >= 0 and <= 6 ? WeekdayNames[weekday] : $"dzień {weekday}")}";

    private static string Allowed(string field, IEnumerable<string> values)
        => $"{field}: dozwolone wartości: {string.Join(", ", values)}.";
}
