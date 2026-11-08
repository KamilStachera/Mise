using Mise.Api.Domain;

namespace Mise.Api.Services.Training;

/// <summary>
/// Catalog rules that don't need the database: what "home" equipment means, search folding,
/// list ordering, and the validated partial update agents use to enrich an exercise.
/// </summary>
public static class ExerciseCatalog
{
    /// <summary>Default home kit until a training profile says otherwise.</summary>
    public static readonly IReadOnlySet<ExerciseEquipment> HomeEquipment = new HashSet<ExerciseEquipment>
    {
        ExerciseEquipment.BodyOnly, ExerciseEquipment.Dumbbell, ExerciseEquipment.Kettlebell,
        ExerciseEquipment.Bands, ExerciseEquipment.ExerciseBall, ExerciseEquipment.MedicineBall,
        ExerciseEquipment.FoamRoll,
    };

    public const int MaxListItems = 12;
    public const int MaxItemLength = 600;

    public static string DisplayName(Exercise e) => string.IsNullOrWhiteSpace(e.NamePl) ? e.NameEn : e.NamePl!;

    /// <summary>Folded (lowercase, no diacritics) haystack: both names.</summary>
    public static string SearchKey(Exercise e) => IngredientMatcher.Normalize(e.NameEn + " " + (e.NamePl ?? ""));

    /// <summary>Every whitespace-separated query word must appear (folded) in either name.</summary>
    public static bool Matches(Exercise e, string? query)
    {
        if (string.IsNullOrWhiteSpace(query)) return true;
        var key = SearchKey(e);
        return IngredientMatcher.Normalize(query).Split(' ', StringSplitOptions.RemoveEmptyEntries)
            .All(w => key.Contains(w, StringComparison.Ordinal));
    }

    /// <summary>
    /// With a muscle filter, exercises where it is the primary muscle come first. Then described
    /// (Polish) exercises, then those with a video, then by display name.
    /// </summary>
    public static IEnumerable<Exercise> Order(IEnumerable<Exercise> items, string? muscle = null) => items
        .OrderBy(e => muscle is not null && !e.PrimaryMuscles.Contains(muscle))
        .ThenBy(e => e.EnrichedAt is null)
        .ThenBy(e => e.YoutubeId is null)
        .ThenBy(DisplayName, Pl.Comparer);

    public record Patch(Exercise Target, Action Apply, string? YoutubeToVerify);

    /// <summary>
    /// Validates an enrichment input against <paramref name="e"/> and returns the change to apply
    /// (nothing is mutated yet), or an error. The caller verifies <c>YoutubeToVerify</c> first.
    /// </summary>
    public static (Patch? Patch, string? Error) Prepare(Exercise e, Features.ExerciseEnrichInput input, DateTimeOffset now)
    {
        var actions = new List<Action>();
        var polish = false;

        if (input.NamePl is not null)
        {
            var name = input.NamePl.Trim();
            if (name.Length is 0 or > 200) return (null, "namePl: 1–200 znaków.");
            actions.Add(() => e.NamePl = name);
            polish = true;
        }
        foreach (var (list, label, set) in new (List<string>?, string, Action<List<string>>)[]
        {
            (input.InstructionsPl, "instructionsPl", v => e.InstructionsPl = v),
            (input.TipsPl, "tipsPl", v => e.TipsPl = v),
            (input.MistakesPl, "mistakesPl", v => e.MistakesPl = v),
        })
        {
            if (list is null) continue;
            if (CleanList(list, label, out var clean) is { } err) return (null, err);
            actions.Add(() => set(clean));
            polish = true;
        }
        if (input.VideoStartSeconds is { } start)
        {
            if (start is < 0 or > 4 * 3600) return (null, "videoStartSeconds: 0–14400.");
            actions.Add(() => e.VideoStartSeconds = start == 0 ? null : start);
        }
        if (input.IsTimed is { } timed) actions.Add(() => e.IsTimed = timed);
        if (input.Hidden is { } hidden) actions.Add(() => e.Hidden = hidden);
        if (input.Level is not null)
        {
            if (!ExerciseTokens.TryParse<ExerciseLevel>(input.Level, out var level))
                return (null, Allowed("level", ExerciseTokens.All<ExerciseLevel>()));
            actions.Add(() => e.Level = level);
        }
        if (input.Category is not null)
        {
            if (!ExerciseTokens.TryParse<ExerciseCategory>(input.Category, out var cat))
                return (null, Allowed("category", ExerciseTokens.All<ExerciseCategory>()));
            actions.Add(() => e.Category = cat);
        }
        if (input.Equipment is not null)
        {
            if (!ExerciseTokens.TryParse<ExerciseEquipment>(input.Equipment, out var eq))
                return (null, Allowed("equipment", ExerciseTokens.All<ExerciseEquipment>()));
            actions.Add(() => e.Equipment = eq);
        }
        if (input.PrimaryMuscles is not null)
        {
            if (!ExerciseTokens.TryParseMuscles(input.PrimaryMuscles, out var m) || m.Count == 0)
                return (null, Allowed("primaryMuscles (min. 1)", ExerciseTokens.All<Muscle>()));
            actions.Add(() => e.PrimaryMuscles = m);
        }
        if (input.SecondaryMuscles is not null)
        {
            if (!ExerciseTokens.TryParseMuscles(input.SecondaryMuscles, out var m))
                return (null, Allowed("secondaryMuscles", ExerciseTokens.All<Muscle>()));
            actions.Add(() => e.SecondaryMuscles = m);
        }

        string? verify = null;
        if (input.YoutubeId is not null)
        {
            if (input.YoutubeId.Trim().Length == 0)
                actions.Add(() => { e.YoutubeId = null; e.VideoTitle = null; e.VideoChannel = null; e.VideoStartSeconds = null; });
            else if (YouTubeVerifier.ExtractId(input.YoutubeId) is null)
                return (null, "youtubeId: nieprawidłowy identyfikator lub link YouTube.");
            else verify = input.YoutubeId;
        }

        if (actions.Count == 0 && verify is null) return (null, "Brak zmian.");
        return (new Patch(e, () =>
        {
            foreach (var a in actions) a();
            if (polish) e.EnrichedAt = now;
            e.UpdatedAt = now;
        }, verify), null);
    }

    /// <summary>Applies a verified video (after <see cref="Prepare"/>'s patch).</summary>
    public static void SetVideo(Exercise e, YouTubeVerifier.Result video)
    {
        e.YoutubeId = video.Id;
        e.VideoTitle = video.Title;
        e.VideoChannel = video.Channel;
    }

    public static string? CleanList(List<string> list, string label, out List<string> clean)
    {
        clean = list.Select(s => (s ?? "").Trim()).Where(s => s.Length > 0).ToList();
        if (clean.Count > MaxListItems) return $"{label}: maks. {MaxListItems} punktów.";
        if (clean.Any(s => s.Length > MaxItemLength)) return $"{label}: punkt dłuższy niż {MaxItemLength} znaków.";
        return null;
    }

    private static string Allowed(string field, IEnumerable<string> values)
        => $"{field}: dozwolone wartości: {string.Join(", ", values)}.";
}
