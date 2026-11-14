using System.Text.RegularExpressions;
using Mise.Api.Domain;
using Mise.Api.Features;

namespace Mise.Api.Services.Training;

/// <summary>
/// A strength plan from the questionnaire alone — no AI — for households without Sous (and as a
/// quick start for everyone). The output is the same <see cref="TrainingProgramInput"/> an agent
/// sends, so it goes through the normal validation, activation and enrichment path.
///
/// Split by days a week (full body A/B/C · upper/lower · mixes), exercises per day by session
/// length, each slot filled from curated staples first (free-exercise-db ids), then by a scored
/// search on the slot's muscles — always within the person's equipment and level. Sets/reps follow
/// the goal; six weeks with an extra set in weeks 3–5, more reps in week 5 and a lighter week 6.
/// </summary>
public static partial class TrainingTemplates
{
    public const int Weeks = 6;

    private sealed record Slot(string[] Muscles, string[] Staples);

    // Staples are tried in order; the first one allowed (equipment, level, unused) wins.
    private static readonly Slot Squat = new(["Quadriceps"], ["Barbell_Squat", "Goblet_Squat", "Dumbbell_Squat", "Bodyweight_Squat"]);
    private static readonly Slot LegPress = new(["Quadriceps"], ["Leg_Press", "Dumbbell_Squat", "Goblet_Squat", "Bodyweight_Squat"]);
    private static readonly Slot Lunge = new(["Quadriceps", "Glutes"], ["Dumbbell_Lunges", "Dumbbell_Step_Ups", "Bodyweight_Walking_Lunge", "Step-up_with_Knee_Raise"]);
    private static readonly Slot Hinge = new(["Hamstrings", "Glutes"], ["Romanian_Deadlift", "Stiff-Legged_Dumbbell_Deadlift", "Kettlebell_One-Legged_Deadlift", "Lying_Leg_Curls", "Single_Leg_Glute_Bridge"]);
    private static readonly Slot Bridge = new(["Glutes"], ["Barbell_Hip_Thrust", "Barbell_Glute_Bridge", "Single_Leg_Glute_Bridge", "Butt_Lift_Bridge", "Hip_Extension_with_Bands"]);
    private static readonly Slot Push = new(["Chest"], ["Barbell_Bench_Press_-_Medium_Grip", "Dumbbell_Bench_Press", "Pushups"]);
    private static readonly Slot InclinePush = new(["Chest"], ["Incline_Dumbbell_Press", "Push-Up_Wide", "Pushups"]);
    private static readonly Slot Row = new(["MiddleBack", "Lats"], ["Seated_Cable_Rows", "Bent_Over_Barbell_Row", "One-Arm_Dumbbell_Row", "Bent_Over_Two-Dumbbell_Row"]);
    private static readonly Slot PullDown = new(["Lats", "MiddleBack"], ["Wide-Grip_Lat_Pulldown", "Pullups", "Chin-Up", "Bent_Over_Two-Dumbbell_Row", "One-Arm_Dumbbell_Row"]);
    private static readonly Slot Press = new(["Shoulders"], ["Standing_Military_Press", "Seated_Dumbbell_Press", "Dumbbell_Shoulder_Press", "Arnold_Dumbbell_Press"]);
    private static readonly Slot Raise = new(["Shoulders"], ["Side_Lateral_Raise", "Band_Pull_Apart", "Face_Pull"]);
    private static readonly Slot Biceps = new(["Biceps"], ["Dumbbell_Bicep_Curl", "Hammer_Curls", "Barbell_Curl", "Alternate_Hammer_Curl"]);
    private static readonly Slot Triceps = new(["Triceps"], ["Triceps_Pushdown", "Standing_Dumbbell_Triceps_Extension", "Bench_Dips", "Tricep_Dumbbell_Kickback"]);
    private static readonly Slot Core = new(["Abdominals"], ["Plank", "Dead_Bug", "Crunches"]);
    private static readonly Slot Core2 = new(["Abdominals"], ["Dead_Bug", "Russian_Twist", "Crunches", "Plank"]);
    private static readonly Slot Calves = new(["Calves"], ["Standing_Calf_Raises", "Standing_Dumbbell_Calf_Raise", "Dumbbell_Seated_One-Leg_Calf_Raise", "Calf_Raises_-_With_Bands"]);
    private static readonly Slot LowerBack = new(["LowerBack"], ["Hyperextensions_Back_Extensions", "Superman"]);

    private sealed record Workout(string Name, Slot[] Slots);

    private static readonly Workout FullA = new("Całe ciało A", [Squat, Push, Row, Hinge, Core, Raise, Calves]);
    private static readonly Workout FullB = new("Całe ciało B", [Bridge, Press, PullDown, Lunge, Core2, Biceps, Triceps]);
    private static readonly Workout FullC = new("Całe ciało C", [Hinge, InclinePush, Row, Lunge, Core, Triceps, Biceps]);
    private static readonly Workout UpperA = new("Góra A", [Push, Row, Press, PullDown, Biceps, Triceps, Core]);
    private static readonly Workout UpperB = new("Góra B", [Press, PullDown, InclinePush, Row, Raise, Triceps, Biceps]);
    private static readonly Workout LowerA = new("Dół A", [Squat, Hinge, Lunge, Calves, Core, Bridge, LowerBack]);
    private static readonly Workout LowerB = new("Dół B", [Hinge, Bridge, LegPress, Calves, Core2, Lunge, LowerBack]);

    private static Workout[] SplitFor(int days) => days switch
    {
        <= 1 => [FullA],
        2 => [FullA, FullB],
        3 => [FullA, FullB, FullC],
        4 => [UpperA, LowerA, UpperB, LowerB],
        5 => [UpperA, LowerA, FullC, UpperB, LowerB],
        _ => [UpperA, LowerA, UpperB, LowerB, FullA, FullB],
    };

    private sealed record Dose(int Sets, int RepsMin, int RepsMax, int Rest, int MainSets, int MainRepsMin, int MainRepsMax, int MainRest, int Seconds);

    private static Dose DoseFor(TrainingGoal goal, ExerciseLevel level)
    {
        var hold = level switch { ExerciseLevel.Beginner => 30, ExerciseLevel.Intermediate => 40, _ => 50 };
        return goal switch
        {
            TrainingGoal.Strength => new(3, 8, 10, 90, 4, 5, 8, 150, hold),
            TrainingGoal.LoseFat => new(3, 12, 15, 45, 3, 10, 12, 60, hold),
            TrainingGoal.Mobility => new(2, 10, 12, 45, 2, 10, 12, 60, hold),
            _ => new(3, 10, 12, 60, 3, 8, 12, 90, hold),
        };
    }

    /// <summary>Equipment that needs a bar or rack nobody has at home by default.</summary>
    [GeneratedRegex(@"pull-?ups?|chin-?ups?|muscle.?up|hanging|dips?_-_|parallel_bar", RegexOptions.IgnoreCase)]
    private static partial Regex NeedsBar();

    /// <summary>The plan input, or a Polish error to show (no questionnaire, styles a template can't do).</summary>
    public static (TrainingProgramInput? Input, string? Error) Build(TrainingProfile profile, IReadOnlyList<Exercise> catalog,
        DateOnly start)
    {
        var styles = profile.Styles;
        if (styles.Count > 0 && !styles.Contains("strength") && !styles.Contains("hiit"))
            return (null, "Szablony to trening siłowy, a w ankiecie wybrano " + string.Join(", ", styles) +
                ". Taki plan ułoży Sous albo dopisz w ankiecie trening siłowy.");

        var days = Math.Clamp(profile.DaysPerWeek, 1, 6);
        var home = profile.Location != TrainingLocation.Gym;
        // The questionnaire stores the home kit without bodyweight (implied): an empty kit = bodyweight only.
        IReadOnlySet<ExerciseEquipment>? allowed = !home ? null
            : profile.HomeEquipment.Count == 0 ? new HashSet<ExerciseEquipment> { ExerciseEquipment.BodyOnly }
            : ExerciseAlternatives.AllowedFor("home", profile);
        var perDay = profile.MinutesPerSession switch { <= 30 => 4, <= 45 => 5, <= 60 => 6, _ => 7 };
        var dose = DoseFor(profile.Goal, profile.Level);

        var pool = catalog
            .Where(e => !e.Hidden && e.Category is ExerciseCategory.Strength or ExerciseCategory.Powerlifting)
            .Where(e => allowed is null || allowed.Contains(e.Equipment))
            .Where(e => !home || !NeedsBar().IsMatch(e.SourceId ?? e.NameEn))
            .ToList();
        var bySource = pool.Where(e => e.SourceId is not null).ToDictionary(e => e.SourceId!);

        var used = new HashSet<Guid>();
        var workouts = SplitFor(days).Select(w =>
        {
            var inDay = new HashSet<Guid>();
            var picks = new List<Exercise>();
            foreach (var slot in w.Slots)
            {
                if (picks.Count == perDay) break;
                if (Pick(slot, pool, bySource, profile.Level, inDay, used) is { } e)
                {
                    picks.Add(e);
                    inDay.Add(e.Id);
                    used.Add(e.Id);
                }
            }
            return (w.Name, Picks: picks);
        }).Where(w => w.Picks.Count > 0).ToList();
        if (workouts.Count == 0)
            return (null, "W katalogu nie ma ćwiczeń pasujących do sprzętu z ankiety — dopisz sprzęt albo wybierz siłownię.");

        var weekdays = PickWeekdays(workouts.Count, profile.PreferredWeekdays);
        // Every workout day of this week already passed (e.g. picked on a Saturday): start next Monday,
        // so the six weeks are six real weeks.
        if (weekdays.All(w => ProgramSchedule.DateOf(start, 1, w) < start))
            start = ProgramSchedule.MondayOf(start).AddDays(7);
        var inputs = new List<ProgramDayInput>();
        for (var week = 1; week <= Weeks; week++)
        {
            for (var i = 0; i < workouts.Count; i++)
            {
                if (ProgramSchedule.DateOf(start, week, weekdays[i]) < start) continue; // week 1 starts today
                var (name, picks) = workouts[i];
                inputs.Add(new ProgramDayInput(week, weekdays[i], name, "exercises", home ? "home" : "gym",
                    WeekNote(week), null, null, null,
                    picks.Select((e, order) => Prescribe(e, order < 2, dose, week)).ToList()));
            }
        }

        var split = workouts.Count switch { <= 3 => "całe ciało", _ => "góra / dół" };
        var where = home ? "w domu" : "na siłowni";
        var input = new TrainingProgramInput(
            Name: $"Plan z szablonu: {split}, {workouts.Count}× w tygodniu",
            Description: $"{Weeks} tygodni, {where}, ok. {profile.MinutesPerSession} min na trening.",
            Rationale: Rationale(profile, split, workouts.Count, where),
            StartDate: start,
            Weeks: Weeks,
            Activate: true,
            CreatedBy: "manual",
            Days: inputs);
        return (input, null);
    }

    private static Exercise? Pick(Slot slot, List<Exercise> pool, Dictionary<string, Exercise> bySource,
        ExerciseLevel level, HashSet<Guid> inDay, HashSet<Guid> used)
    {
        // Within the level first, then one step up (free-exercise-db rates some staples oddly).
        foreach (var maxLevel in new[] { level, (ExerciseLevel)Math.Min((int)level + 1, (int)ExerciseLevel.Expert) })
        {
            // Unused staples, then reused staples (variety across workouts, never twice in a day).
            foreach (var allowReuse in new[] { false, true })
            {
                var staple = slot.Staples
                    .Select(id => bySource.GetValueOrDefault(id))
                    .FirstOrDefault(e => e is not null && e.Level <= maxLevel && !inDay.Contains(e.Id)
                        && (allowReuse || !used.Contains(e.Id)));
                if (staple is not null) return staple;
            }
            var searched = pool
                .Where(e => e.Level <= maxLevel && !inDay.Contains(e.Id) && e.PrimaryMuscles.Any(slot.Muscles.Contains))
                .OrderBy(e => used.Contains(e.Id))
                .ThenBy(e => slot.Muscles.Contains(e.PrimaryMuscles.FirstOrDefault() ?? "") ? 0 : 1)
                .ThenBy(e => e.Mechanic == ExerciseMechanic.Compound ? 0 : 1)
                .ThenBy(e => e.EnrichedAt is null)
                .ThenBy(e => e.YoutubeId is null)
                .ThenBy(e => e.NameEn, StringComparer.Ordinal)
                .FirstOrDefault();
            if (searched is not null) return searched;
        }
        return null;
    }

    /// <summary>The first two slots are the day's main lifts: heavier dose, and they get the extra set.</summary>
    private static ProgramExerciseInput Prescribe(Exercise e, bool main, Dose d, int week)
    {
        var sets = main ? d.MainSets : d.Sets;
        if (week is >= 3 and <= 5 && main) sets = Math.Min(sets + 1, 5);
        if (week == Weeks) sets = Math.Max(sets - 1, 2);
        var rest = main ? d.MainRest : d.Rest;
        if (e.IsTimed)
        {
            var seconds = d.Seconds + (week is >= 3 and <= 5 ? 10 : 0) - (week == Weeks ? 10 : 0);
            return new(e.Id, sets, null, null, seconds, Math.Min(rest, 60), null, null, null);
        }
        var (lo, hi) = main ? (d.MainRepsMin, d.MainRepsMax) : (d.RepsMin, d.RepsMax);
        if (week == 5) (lo, hi) = (lo + 1, hi + 2);
        return new(e.Id, sets, lo, hi, null, rest, null, null, null);
    }

    private static string WeekNote(int week) => week switch
    {
        1 => "Ciężar dobierz tak, żeby ostatnie 2 powtórzenia były trudne, ale technicznie czyste.",
        3 => "Od tego tygodnia dodatkowa seria w dwóch pierwszych ćwiczeniach.",
        5 => "Więcej powtórzeń — jeśli wchodzą łatwo, dołóż trochę ciężaru.",
        Weeks => "Tydzień lżejszy: mniej serii, ten sam albo mniejszy ciężar — regeneracja przed kolejnym planem.",
        _ => "",
    };

    /// <summary>The questionnaire's preferred days (evenly spread), topped up with sensible defaults.</summary>
    public static int[] PickWeekdays(int count, int preferredMask)
    {
        int[] defaults = count switch
        {
            1 => [2],
            2 => [0, 3],
            3 => [0, 2, 4],
            4 => [0, 1, 3, 4],
            5 => [0, 1, 2, 3, 4],
            _ => [0, 1, 2, 3, 4, 5],
        };
        var preferred = Enumerable.Range(0, 7).Where(d => (preferredMask & (1 << d)) != 0).ToList();
        if (preferred.Count == 0) return defaults;
        if (preferred.Count >= count)
            return Enumerable.Range(0, count).Select(i => preferred[i * preferred.Count / count]).ToArray();
        var extra = defaults.Concat(Enumerable.Range(0, 7)).Where(d => !preferred.Contains(d)).Distinct();
        return preferred.Concat(extra).Take(count).Order().ToArray();
    }

    private static string Rationale(TrainingProfile p, string split, int days, string where)
    {
        var goal = p.Goal switch
        {
            TrainingGoal.Strength => "siła: mniej powtórzeń, więcej przerwy",
            TrainingGoal.LoseFat => "spalanie: więcej powtórzeń, krótkie przerwy",
            TrainingGoal.Tone => "ujędrnienie: 8–12 powtórzeń",
            TrainingGoal.Mobility => "mobilność: lżej, mniej serii",
            _ => "ogólna forma: 8–12 powtórzeń",
        };
        var text = $"Plan z gotowego szablonu (bez AI), ułożony z ankiety: {split} {days}× w tygodniu, {where}. " +
            $"Pod cel — {goal}. Dwa pierwsze ćwiczenia dnia to główne ruchy wielostawowe; " +
            "tygodnie 3–5 dokładają serię, tydzień 5 powtórzenia, tydzień 6 jest lżejszy.";
        if (!string.IsNullOrWhiteSpace(p.Limitations))
            text += $" W ankiecie: „{p.Limitations.Trim()}” — szablon tego nie uwzględnia, więc przejrzyj ćwiczenia " +
                "i zamień te, które przeszkadzają (przycisk „Zamień” przy ćwiczeniu).";
        return text;
    }
}
