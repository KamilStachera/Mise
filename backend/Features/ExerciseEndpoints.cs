using Microsoft.EntityFrameworkCore;
using Mise.Api.Data;
using Mise.Api.Domain;
using Mise.Api.Services;
using Mise.Api.Services.Training;

namespace Mise.Api.Features;

/// <summary>
/// The shared exercise catalog — public to read like recipes (anonymous writes are blocked by
/// ApiAccessMiddleware). Per-person training data lives under /training, which is private.
/// </summary>
public static class ExerciseEndpoints
{
    public const int MaxBatch = 50;

    public static RouteGroupBuilder MapExercises(this RouteGroupBuilder api)
    {
        var g = api.MapGroup("/exercises").WithTags("Exercises");

        g.MapGet("/", async (string? q, string? muscle, string? equipment, string? level, string? category,
            bool? enriched, bool? video, string? location, bool? includeHidden, bool? primaryOnly, int? limit, int? offset,
            MiseDbContext db) =>
        {
            var query = db.Exercises.AsNoTracking();
            if (includeHidden != true) query = query.Where(e => !e.Hidden);

            string? muscleName = null;
            if (!string.IsNullOrWhiteSpace(muscle))
            {
                if (!ExerciseTokens.TryParse<Muscle>(muscle, out var m)) return Bad("muscle", ExerciseTokens.All<Muscle>());
                muscleName = m.ToString();
                // Primary OR secondary: upstream tags most lunges/hip work with glutes only as
                // secondary — primary-only would hide them. Primary matches sort first below.
                query = primaryOnly == true
                    ? query.Where(e => e.PrimaryMuscles.Contains(muscleName))
                    : query.Where(e => e.PrimaryMuscles.Contains(muscleName) || e.SecondaryMuscles.Contains(muscleName));
            }
            if (!string.IsNullOrWhiteSpace(equipment))
            {
                var wanted = new List<ExerciseEquipment>();
                foreach (var token in equipment.Split(',', StringSplitOptions.RemoveEmptyEntries))
                {
                    if (!ExerciseTokens.TryParse<ExerciseEquipment>(token, out var eq))
                        return Bad("equipment", ExerciseTokens.All<ExerciseEquipment>());
                    wanted.Add(eq);
                }
                query = query.Where(e => wanted.Contains(e.Equipment));
            }
            if (!string.IsNullOrWhiteSpace(level))
            {
                if (!ExerciseTokens.TryParse<ExerciseLevel>(level, out var l)) return Bad("level", ExerciseTokens.All<ExerciseLevel>());
                query = query.Where(e => e.Level == l);
            }
            if (!string.IsNullOrWhiteSpace(category))
            {
                if (!ExerciseTokens.TryParse<ExerciseCategory>(category, out var c)) return Bad("category", ExerciseTokens.All<ExerciseCategory>());
                query = query.Where(e => e.Category == c);
            }
            if (enriched is { } en) query = en ? query.Where(e => e.EnrichedAt != null) : query.Where(e => e.EnrichedAt == null);
            if (video is { } v) query = v ? query.Where(e => e.YoutubeId != null) : query.Where(e => e.YoutubeId == null);
            switch (location?.Trim().ToLowerInvariant())
            {
                case null or "" or "any" or "gym": break;
                case "home":
                    var home = ExerciseCatalog.HomeEquipment.ToList();
                    query = query.Where(e => home.Contains(e.Equipment));
                    break;
                default: return Bad("location", ["home", "gym", "any"]);
            }

            var rows = await query.ToListAsync();
            var matched = ExerciseCatalog.Order(rows.Where(e => ExerciseCatalog.Matches(e, q)), muscleName).ToList();
            var take = Math.Clamp(limit ?? 60, 1, 1000);
            var skip = Math.Max(0, offset ?? 0);
            var catalogTotal = await db.Exercises.CountAsync(e => !e.Hidden);
            var enrichedTotal = await db.Exercises.CountAsync(e => !e.Hidden && e.EnrichedAt != null);
            return Results.Ok(new ExerciseListDto(matched.Count, enrichedTotal, catalogTotal,
                matched.Skip(skip).Take(take).Select(ToListDto).ToList()));
        });

        g.MapGet("/vocabulary", () => Results.Ok(new ExerciseVocabularyDto(
            ExerciseTokens.All<Muscle>(), ExerciseTokens.All<ExerciseEquipment>(),
            ExerciseTokens.All<ExerciseCategory>(), ExerciseTokens.All<ExerciseLevel>(),
            ExerciseTokens.All<ExerciseForce>(), ExerciseTokens.All<ExerciseMechanic>())));

        g.MapGet("/{id:guid}", async (Guid id, MiseDbContext db) =>
            await db.Exercises.AsNoTracking().FirstOrDefaultAsync(e => e.Id == id) is { } e
                ? Results.Ok(ToDetailDto(e))
                : Results.NotFound());

        g.MapGet("/{id:guid}/images/{n:int}.webp", async (Guid id, int n, HttpContext ctx,
            MiseDbContext db, ExerciseImages images) =>
        {
            var paths = await db.Exercises.AsNoTracking().Where(e => e.Id == id)
                .Select(e => e.ImagePaths).FirstOrDefaultAsync();
            if (paths is null || n < 0 || n >= paths.Count) return Results.NotFound();
            var file = await images.GetAsync(paths[n], ctx.RequestAborted);
            if (file is null) return Results.NotFound();
            // Immutable for the pinned upstream commit: let phones keep it.
            ctx.Response.Headers.CacheControl = "public, max-age=2592000";
            return Results.File(file, "image/webp", lastModified: File.GetLastWriteTimeUtc(file));
        });

        g.MapPatch("/{id:guid}", async (Guid id, ExerciseEnrichInput input, MiseDbContext db,
            YouTubeVerifier youtube, CancellationToken ct) =>
        {
            var e = await db.Exercises.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (e is null) return Results.NotFound();
            if (await ApplyAsync(e, input, youtube, ct) is { } error)
                return Results.BadRequest(new { error });
            await db.SaveChangesAsync(ct);
            return Results.Ok(ToDetailDto(e));
        });

        g.MapPost("/enrich", async (ExerciseEnrichBatchInput input, MiseDbContext db,
            YouTubeVerifier youtube, CancellationToken ct) =>
        {
            if (input.Items is not { Count: > 0 } items) return Results.BadRequest(new { error = "Pusta lista items." });
            if (items.Count > MaxBatch) return Results.BadRequest(new { error = $"Maks. {MaxBatch} ćwiczeń naraz." });
            var ids = items.Where(i => i.Id is not null).Select(i => i.Id!.Value).ToList();
            var byId = await db.Exercises.Where(e => ids.Contains(e.Id)).ToDictionaryAsync(e => e.Id, ct);
            var errors = new List<ExerciseEnrichErrorDto>();
            var updated = 0;
            foreach (var item in items)
            {
                if (item.Id is not { } id || !byId.TryGetValue(id, out var e))
                {
                    errors.Add(new(item.Id, "Nie ma takiego ćwiczenia (id)."));
                    continue;
                }
                if (await ApplyAsync(e, item, youtube, ct) is { } error) errors.Add(new(id, error));
                else updated++;
            }
            await db.SaveChangesAsync(ct);
            return Results.Ok(new ExerciseEnrichResultDto(updated, errors));
        });

        g.MapPost("/", async (ExerciseCreateInput input, MiseDbContext db, YouTubeVerifier youtube,
            CancellationToken ct) =>
        {
            var name = input.NamePl?.Trim() ?? "";
            if (name.Length is 0 or > 200) return Results.BadRequest(new { error = "namePl: 1–200 znaków." });
            var folded = IngredientMatcher.Normalize(name);
            var names = await db.Exercises.AsNoTracking()
                .Select(x => new { x.Id, x.NameEn, x.NamePl }).ToListAsync(ct);
            var dup = names.FirstOrDefault(x => IngredientMatcher.Normalize(x.NamePl ?? "") == folded
                || IngredientMatcher.Normalize(x.NameEn) == folded);
            if (dup is not null)
                return Results.Conflict(new { error = $"Takie ćwiczenie już jest: {dup.NamePl ?? dup.NameEn}.", id = dup.Id });

            var e = new Exercise { NameEn = string.IsNullOrWhiteSpace(input.NameEn) ? name : input.NameEn.Trim() };
            var patch = new ExerciseEnrichInput(null, name, input.InstructionsPl, input.TipsPl, input.MistakesPl,
                input.YoutubeId, input.VideoStartSeconds, input.IsTimed, null, input.Level ?? "beginner",
                input.Category ?? "strength", input.Equipment ?? "body-only",
                input.PrimaryMuscles ?? [], input.SecondaryMuscles);
            if (await ApplyAsync(e, patch, youtube, ct) is { } error) return Results.BadRequest(new { error });
            db.Exercises.Add(e);
            await db.SaveChangesAsync(ct);
            return Results.Created($"/api/exercises/{e.Id}", ToDetailDto(e));
        });

        return api;
    }

    /// <summary>Validate → verify the video (network) → mutate. On failure <paramref name="e"/> is left untouched.</summary>
    private static async Task<string?> ApplyAsync(Exercise e, ExerciseEnrichInput input, YouTubeVerifier youtube,
        CancellationToken ct)
    {
        var (patch, error) = ExerciseCatalog.Prepare(e, input, DateTimeOffset.UtcNow);
        if (patch is null) return error;
        YouTubeVerifier.Result? video = null;
        if (patch.YoutubeToVerify is { } yt)
        {
            video = await youtube.VerifyAsync(yt, ct);
            if (!video.Ok) return video.Error;
        }
        patch.Apply();
        if (video is not null) ExerciseCatalog.SetVideo(e, video);
        return null;
    }

    private static IResult Bad(string field, IEnumerable<string> allowed)
        => Results.BadRequest(new { error = $"{field}: dozwolone wartości: {string.Join(", ", allowed)}." });

    public static string ImageUrl(Guid id, int n) => $"/api/exercises/{id}/images/{n}.webp";

    public static ExerciseListItemDto ToListDto(Exercise e) => new(
        e.Id, ExerciseCatalog.DisplayName(e), e.NameEn, e.NamePl,
        ExerciseTokens.Of(e.Category), ExerciseTokens.Of(e.Level), ExerciseTokens.Of(e.Equipment),
        ExerciseTokens.MuscleTokens(e.PrimaryMuscles), ExerciseTokens.MuscleTokens(e.SecondaryMuscles),
        e.IsTimed, e.YoutubeId is not null, e.EnrichedAt is not null,
        e.ImagePaths.Count > 0 ? ImageUrl(e.Id, 0) : null);

    public static ExerciseDetailDto ToDetailDto(Exercise e)
    {
        var pl = e.InstructionsPl.Count > 0;
        return new(e.Id, e.SourceId, ExerciseCatalog.DisplayName(e), e.NameEn, e.NamePl,
            ExerciseTokens.Of(e.Category), ExerciseTokens.Of(e.Level), ExerciseTokens.Of(e.Force),
            ExerciseTokens.Of(e.Mechanic), ExerciseTokens.Of(e.Equipment),
            ExerciseTokens.MuscleTokens(e.PrimaryMuscles), ExerciseTokens.MuscleTokens(e.SecondaryMuscles),
            pl ? e.InstructionsPl : e.InstructionsEn, pl, e.InstructionsEn, e.InstructionsPl,
            e.TipsPl, e.MistakesPl, e.YoutubeId, e.VideoStartSeconds, e.VideoTitle, e.VideoChannel,
            Enumerable.Range(0, e.ImagePaths.Count).Select(n => ImageUrl(e.Id, n)).ToList(),
            e.IsTimed, e.Hidden, e.EnrichedAt);
    }
}
