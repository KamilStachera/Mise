using System.Reflection;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Mise.Api.Data;
using Mise.Api.Domain;

namespace Mise.Api.Services.Training;

/// <summary>
/// Seeds the shared exercise catalog from the vendored free-exercise-db JSON
/// (github.com/yuhonas/free-exercise-db, The Unlicense — public domain), pinned to
/// <see cref="UpstreamSha"/>. Runs on every boot and only INSERTS source ids that are
/// missing: existing rows are never touched, so agent enrichment is never overwritten.
/// </summary>
public static class ExerciseImport
{
    /// <summary>Upstream commit of the vendored JSON; images are fetched from the same commit.</summary>
    public const string UpstreamSha = "f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5";
    public const string ResourceName = "free-exercise-db.json";

    /// <summary>Categories kept out of the catalog (niche for a home/gym plan).</summary>
    private static readonly HashSet<ExerciseCategory> HiddenCategories =
        [ExerciseCategory.Strongman, ExerciseCategory.OlympicWeightlifting];

    public static async Task<int> EnsureImportedAsync(MiseDbContext db, CancellationToken ct = default)
    {
        await using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(ResourceName)
            ?? throw new InvalidOperationException($"Embedded resource {ResourceName} missing.");
        return await ImportAsync(db, stream, ct);
    }

    public static async Task<int> ImportAsync(MiseDbContext db, Stream json, CancellationToken ct = default)
    {
        using var doc = await JsonDocument.ParseAsync(json, cancellationToken: ct);
        var known = (await db.Exercises.Where(e => e.SourceId != null).Select(e => e.SourceId!).ToListAsync(ct))
            .ToHashSet(StringComparer.Ordinal);
        var added = 0;
        foreach (var el in doc.RootElement.EnumerateArray())
        {
            var ex = Map(el);
            if (ex is null || !known.Add(ex.SourceId!)) continue;
            db.Exercises.Add(ex);
            added++;
        }
        if (added > 0) await db.SaveChangesAsync(ct);
        return added;
    }

    /// <summary>One upstream record → a new Exercise; null when the record has no usable id/name.</summary>
    public static Exercise? Map(JsonElement el)
    {
        var id = Str(el, "id");
        var name = Str(el, "name");
        if (string.IsNullOrWhiteSpace(id) || string.IsNullOrWhiteSpace(name)) return null;

        var category = ExerciseTokens.TryParse<ExerciseCategory>(Str(el, "category"), out var c)
            ? c : ExerciseCategory.Strength;
        ExerciseForce? force = ExerciseTokens.TryParse<ExerciseForce>(Str(el, "force"), out var f) ? f : null;
        ExerciseMechanic? mechanic = ExerciseTokens.TryParse<ExerciseMechanic>(Str(el, "mechanic"), out var m) ? m : null;

        return new Exercise
        {
            SourceId = id,
            NameEn = name.Trim(),
            Category = category,
            Level = ExerciseTokens.TryParse<ExerciseLevel>(Str(el, "level"), out var l) ? l : ExerciseLevel.Beginner,
            Force = force,
            Mechanic = mechanic,
            Equipment = MapEquipment(Str(el, "equipment")),
            PrimaryMuscles = Muscles(el, "primaryMuscles"),
            SecondaryMuscles = Muscles(el, "secondaryMuscles"),
            InstructionsEn = Strings(el, "instructions"),
            ImagePaths = Strings(el, "images").Where(ExerciseImages.IsValidPath).ToList(),
            IsTimed = category == ExerciseCategory.Stretching || force == ExerciseForce.Static,
            Hidden = HiddenCategories.Contains(category),
        };
    }

    /// <summary>Upstream equipment strings; null (unspecified) is treated as bodyweight.</summary>
    public static ExerciseEquipment MapEquipment(string? s) => s?.Trim().ToLowerInvariant() switch
    {
        null or "" or "body only" => ExerciseEquipment.BodyOnly,
        "kettlebells" or "kettlebell" => ExerciseEquipment.Kettlebell,
        "e-z curl bar" => ExerciseEquipment.EzBar,
        var other => ExerciseTokens.TryParse<ExerciseEquipment>(other, out var e) ? e : ExerciseEquipment.Other,
    };

    private static List<string> Muscles(JsonElement el, string prop)
    {
        var names = new List<string>();
        foreach (var token in Strings(el, prop))
            if (ExerciseTokens.TryParse<Muscle>(token, out var m) && !names.Contains(m.ToString()))
                names.Add(m.ToString());
        return names;
    }

    private static string? Str(JsonElement el, string prop)
        => el.TryGetProperty(prop, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    private static List<string> Strings(JsonElement el, string prop)
        => el.TryGetProperty(prop, out var v) && v.ValueKind == JsonValueKind.Array
            ? v.EnumerateArray().Where(x => x.ValueKind == JsonValueKind.String)
                .Select(x => x.GetString()!.Trim()).Where(x => x.Length > 0).ToList()
            : [];
}
