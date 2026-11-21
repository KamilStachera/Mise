using System.Security.Cryptography;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using Mise.Api.Data;
using Mise.Api.Domain;
using Mise.Api.Services;

namespace Mise.Api.Features;

public record RecipeShareStatusDto(bool Active, string? Token, string? Path, DateTimeOffset? CreatedAt, DateTimeOffset? ExpiresAt);

public record SharedIngredientDto(string Name, string Quantity, string? DisplayText, string? AlternativeGroup);

public record SharedImageDto(Guid Id, string Url, bool IsDefault);

public record SharedRecipeDto(
    string Token,
    string SharedByHousehold,
    DateTimeOffset ExpiresAt,
    bool IsOwnHousehold,
    Guid? OwnRecipeId,
    string Title,
    string Source,
    string? SourceName,
    int Time,
    int Servings,
    string Difficulty,
    string Tint,
    string Blurb,
    string? Tip,
    string? ImageUrl,
    List<SharedImageDto> Images,
    string? DishType,
    string? Cuisine,
    bool UsesAirFryer,
    int? Kcal,
    decimal? Protein,
    decimal? Fat,
    decimal? Carbs,
    List<string> Tags,
    List<SharedIngredientDto> Ingredients,
    List<string> Steps);

/// <summary>
/// Cross-household recipe sharing: a household creates a revocable 30-day link (/s/{token}) for one
/// recipe; anyone with the link can read ONLY that recipe + its photos, and signed-in members of
/// another household can clone an independent copy into their own cookbook in one click.
/// </summary>
public static class SharedRecipeEndpoints
{
    public static RouteGroupBuilder MapSharedRecipes(this RouteGroupBuilder api)
    {
        var r = api.MapGroup("/recipes").WithTags("Recipes");

        r.MapGet("/{id:guid}/share", async (Guid id, MiseDbContext db, CancellationToken ct) =>
        {
            if (!await db.Recipes.AsNoTracking().AnyAsync(x => x.Id == id, ct))
                return Results.NotFound();
            var now = DateTimeOffset.UtcNow;
            var share = await db.RecipeShares.AsNoTracking()
                .Where(s => s.RecipeId == id && s.RevokedAt == null && s.ExpiresAt > now)
                .OrderByDescending(s => s.CreatedAt)
                .FirstOrDefaultAsync(ct);
            return Results.Ok(ToStatusDto(share));
        });

        r.MapPost("/{id:guid}/share", async (Guid id, Caller caller, MiseDbContext db, CancellationToken ct) =>
        {
            if (!await db.Recipes.AsNoTracking().AnyAsync(x => x.Id == id, ct))
                return Results.NotFound();
            var now = DateTimeOffset.UtcNow;
            var existing = await db.RecipeShares.AsNoTracking()
                .Where(s => s.RecipeId == id && s.RevokedAt == null && s.ExpiresAt > now)
                .OrderByDescending(s => s.CreatedAt)
                .FirstOrDefaultAsync(ct);
            if (existing is not null)
                return Results.Ok(ToStatusDto(existing));

            var share = new RecipeShare
            {
                RecipeId = id,
                Token = WebEncoders.Base64UrlEncode(RandomNumberGenerator.GetBytes(16)),
                CreatedByPersonId = caller.Self?.Id,
                CreatedAt = now,
                ExpiresAt = now + RecipeShare.DefaultLifetime,
            };
            db.RecipeShares.Add(share);
            await db.SaveChangesAsync(ct);
            return Results.Ok(ToStatusDto(share));
        });

        r.MapDelete("/{id:guid}/share", async (Guid id, MiseDbContext db, CancellationToken ct) =>
        {
            if (!await db.Recipes.AsNoTracking().AnyAsync(x => x.Id == id, ct))
                return Results.NotFound();
            var now = DateTimeOffset.UtcNow;
            var active = await db.RecipeShares
                .Where(s => s.RecipeId == id && s.RevokedAt == null)
                .ToListAsync(ct);
            if (active.Count > 0)
            {
                foreach (var s in active) s.RevokedAt = now;
                await db.SaveChangesAsync(ct);
            }
            return Results.NoContent();
        });

        var s = api.MapGroup("/shared").WithTags("Shared");

        s.MapGet("/{token}", async (string token, Caller caller, MiseDbContext db, CancellationToken ct) =>
        {
            var share = await LoadActiveShareAsync(db, token, ct);
            if (share?.Recipe is not { } recipe)
                return Results.NotFound(new { error = "Ten link wygasł lub został cofnięty." });

            var householdName = await db.Households.AsNoTracking()
                .Where(h => h.Id == share.HouseholdId)
                .Select(h => h.Name)
                .FirstOrDefaultAsync(ct) ?? "Pichci";
            var isOwn = caller.IsPrivileged && caller.HouseholdId == share.HouseholdId;

            var imgs = recipe.Images.OrderByDescending(i => i.CreatedAt)
                .Select(i => new SharedImageDto(i.Id, $"/api/shared/{share.Token}/image/{i.Id}", i.Path == recipe.ImagePath))
                .ToList();
            var defaultUrl = imgs.FirstOrDefault(i => i.IsDefault)?.Url ?? imgs.FirstOrDefault()?.Url;

            return Results.Ok(new SharedRecipeDto(
                share.Token,
                householdName,
                share.ExpiresAt,
                isOwn,
                isOwn ? recipe.Id : null,
                recipe.Title,
                Mapping.SourceString(recipe.Source),
                recipe.SourceName,
                recipe.TimeMinutes,
                recipe.Servings,
                recipe.Difficulty,
                recipe.Tint,
                recipe.Blurb,
                recipe.Tip,
                defaultUrl,
                imgs,
                Mapping.DishTypeString(recipe.DishType),
                Mapping.CuisineString(recipe.Cuisine),
                AirFryer.Uses(recipe),
                recipe.KcalPerServing,
                recipe.ProteinGrams,
                recipe.FatGrams,
                recipe.CarbGrams,
                [..recipe.Tags],
                recipe.Ingredients.OrderBy(i => i.Order)
                    .Select(i => new SharedIngredientDto(i.Name, i.Quantity, i.DisplayText, i.AlternativeGroup))
                    .ToList(),
                recipe.Steps.OrderBy(st => st.Order).Select(st => st.Text).ToList()));
        });

        s.MapGet("/{token}/image/{imageId:guid}", async (string token, Guid imageId, HttpContext ctx,
            MiseDbContext db, RecipeImageStore store, CancellationToken ct) =>
        {
            if (!IsValidToken(token)) return Results.NotFound();
            var now = DateTimeOffset.UtcNow;
            var share = await db.RecipeShares.IgnoreQueryFilters().AsNoTracking()
                .FirstOrDefaultAsync(x => x.Token == token && x.RevokedAt == null && x.ExpiresAt > now, ct);
            if (share is null) return Results.NotFound();

            var img = await db.RecipeImages.IgnoreQueryFilters().AsNoTracking()
                .FirstOrDefaultAsync(i => i.Id == imageId && i.RecipeId == share.RecipeId, ct);
            if (img is null) return Results.NotFound();

            var path = store.GetOriginalPath(img.Path);
            if (path is null) return Results.NotFound();

            var contentType = Path.GetExtension(path).ToLowerInvariant() switch
            {
                ".webp" => "image/webp",
                ".png" => "image/png",
                ".jpg" or ".jpeg" => "image/jpeg",
                _ => "application/octet-stream",
            };
            ctx.Response.Headers["X-Content-Type-Options"] = "nosniff";
            ctx.Response.Headers.CacheControl = "private, no-cache";
            var info = new FileInfo(path);
            return Results.File(path, contentType, lastModified: info.LastWriteTimeUtc,
                entityTag: new Microsoft.Net.Http.Headers.EntityTagHeaderValue($"\"{info.Length:x}-{info.LastWriteTimeUtc.Ticks:x}\""));
        });

        // Authenticated member only (ApiAccessMiddleware enforces auth on POST /api/shared/*).
        s.MapPost("/{token}/import", async (string token, Caller caller, MiseDbContext db,
            IngredientMatcher matcher, RecipeImageStore images, ContextExportService export, CancellationToken ct) =>
        {
            if (caller.HouseholdId is null) return Results.Unauthorized();
            var share = await LoadActiveShareAsync(db, token, ct);
            if (share?.Recipe is not { } source)
                return Results.NotFound(new { error = "Ten link wygasł lub został cofnięty." });

            var copy = HouseholdProvisioner.CloneRecipe(images, source);
            var pantry = await db.PantryItems.AsNoTracking().ToListAsync(ct);
            foreach (var ing in copy.Ingredients)
                ing.PantryItemId = matcher.FindMatch(ing.Name, pantry)?.Id;

            db.Recipes.Add(copy);
            await db.SaveChangesAsync(ct);
            export.Schedule();
            return Results.Created($"/api/recipes/{copy.Id}", new { id = copy.Id, title = copy.Title });
        }).RequireRateLimiting(HouseholdEndpoints.ImportRateLimit);

        return api;
    }

    private static RecipeShareStatusDto ToStatusDto(RecipeShare? s) =>
        s is null
            ? new RecipeShareStatusDto(false, null, null, null, null)
            : new RecipeShareStatusDto(true, s.Token, $"/s/{s.Token}", s.CreatedAt, s.ExpiresAt);

    private static bool IsValidToken(string? token) =>
        !string.IsNullOrWhiteSpace(token) && token.Length is >= 16 and <= 64;

    private static async Task<RecipeShare?> LoadActiveShareAsync(MiseDbContext db, string token, CancellationToken ct)
    {
        if (!IsValidToken(token)) return null;
        var now = DateTimeOffset.UtcNow;
        var share = await db.RecipeShares.IgnoreQueryFilters().AsNoTracking()
            .FirstOrDefaultAsync(x => x.Token == token && x.RevokedAt == null && x.ExpiresAt > now, ct);
        if (share is null) return null;

        share.Recipe = await db.Recipes.IgnoreQueryFilters().AsNoTracking()
            .Include(r => r.Ingredients)
            .Include(r => r.Steps)
            .Include(r => r.Images)
            .AsSplitQuery()
            .FirstOrDefaultAsync(r => r.Id == share.RecipeId && r.HouseholdId == share.HouseholdId, ct);
        return share;
    }
}
