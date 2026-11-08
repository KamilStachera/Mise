using Mise.Api.Domain;

namespace Mise.Api.Services.Training;

/// <summary>
/// "Zamień ćwiczenie": candidates that train the same thing. A candidate must share at least one
/// primary muscle and fit the allowed equipment; it is scored on muscle overlap and movement
/// similarity, and the direction decides the level window (easier / similar / harder).
/// </summary>
public static class ExerciseAlternatives
{
    public enum Direction { Similar, Easier, Harder }

    public static IReadOnlyList<Exercise> For(Exercise target, IEnumerable<Exercise> catalog,
        IReadOnlySet<ExerciseEquipment>? allowed, Direction direction, int take = 8)
    {
        var primary = target.PrimaryMuscles.ToHashSet();
        var secondary = target.SecondaryMuscles.ToHashSet();
        return catalog
            .Where(e => !e.Hidden && e.Id != target.Id)
            .Where(e => e.PrimaryMuscles.Any(primary.Contains))
            .Where(e => allowed is null || allowed.Contains(e.Equipment))
            // A stretch is never a substitute for a loaded movement (and vice versa).
            .Where(e => (e.Category == ExerciseCategory.Stretching) == (target.Category == ExerciseCategory.Stretching))
            .Where(e => direction switch
            {
                Direction.Easier => e.Level <= target.Level,
                Direction.Harder => e.Level >= target.Level,
                _ => true,
            })
            .Select(e => (Ex: e, Score: Score(target, e, primary, secondary, direction)))
            .OrderByDescending(x => x.Score)
            .ThenBy(x => ExerciseCatalog.DisplayName(x.Ex), Pl.Comparer)
            .Take(take)
            .Select(x => x.Ex)
            .ToList();
    }

    private static int Score(Exercise target, Exercise e, HashSet<string> primary, HashSet<string> secondary,
        Direction direction)
    {
        var score = 3 * e.PrimaryMuscles.Count(primary.Contains)
            + e.SecondaryMuscles.Count(m => secondary.Contains(m) || primary.Contains(m));
        if (e.Mechanic == target.Mechanic) score++;
        if (e.Force == target.Force) score++;
        // Same kind of training (strength vs plyometrics vs cardio) matters more than one shared detail.
        if (e.Category == target.Category) score += 2;
        score += direction switch
        {
            Direction.Easier when e.Level < target.Level => 2,
            Direction.Harder when e.Level > target.Level => 2,
            Direction.Similar when e.Level == target.Level => 2,
            _ => 0,
        };
        // Prefer ones she can actually learn from: Polish description, a demo video.
        if (e.EnrichedAt is not null) score++;
        if (e.YoutubeId is not null) score++;
        return score;
    }

    /// <summary>
    /// Equipment allowed for a location: home = her kit (or the default home set) + bodyweight;
    /// none = bodyweight only; gym/any = everything (null).
    /// </summary>
    public static IReadOnlySet<ExerciseEquipment>? AllowedFor(string? location, TrainingProfile? profile)
    {
        switch (location?.Trim().ToLowerInvariant())
        {
            case "none" or "bodyweight":
                return new HashSet<ExerciseEquipment> { ExerciseEquipment.BodyOnly };
            case "home":
                if (profile is null || profile.HomeEquipment.Count == 0) return ExerciseCatalog.HomeEquipment;
                var set = profile.HomeEquipment
                    .Select(n => Enum.TryParse<ExerciseEquipment>(n, out var e) ? e : (ExerciseEquipment?)null)
                    .OfType<ExerciseEquipment>()
                    .ToHashSet();
                set.Add(ExerciseEquipment.BodyOnly);
                return set;
            default:
                return null;
        }
    }
}
