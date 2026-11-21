using Microsoft.EntityFrameworkCore;
using Mise.Api.Data;
using Mise.Api.Services;

namespace Mise.Api.Features;

public static class ImageEndpoints
{
    public static RouteGroupBuilder MapImages(this RouteGroupBuilder api)
    {
        api.MapGet("/images/{fileName}", async (string fileName, HttpContext ctx, MiseDbContext db,
            RecipeImageStore store, CancellationToken ct) =>
        {
            if (fileName != Path.GetFileName(fileName)) return Results.NotFound();
            if (!await OwnedByTenantAsync(db, fileName, ct)) return Results.NotFound();
            var path = store.GetOriginalPath(fileName);
            if (path is null) return Results.NotFound();
            return ServeImage(ctx, path);
        }).WithTags("Recipes");

        api.MapGet("/images/{fileName}/card-v1.webp", async (string fileName,
            HttpContext ctx, MiseDbContext db, RecipeImageStore store, ILogger<RecipeImageStore> logger,
            CancellationToken ct) =>
        {
            if (fileName != Path.GetFileName(fileName)) return Results.NotFound();
            if (!await OwnedByTenantAsync(db, fileName, ct)) return Results.NotFound();
            string? path;
            try { path = await store.GetCardAsync(fileName, ct); }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogWarning(ex, "Could not generate recipe thumbnail for {FileName}", fileName);
                path = store.GetOriginalPath(fileName);
            }
            if (path is null || !File.Exists(path)) return Results.NotFound();
            return ServeImage(ctx, path);
        }).WithTags("Recipes");
        return api;
    }

    /// <summary>Tenant-scoped check: only serves images belonging to a recipe in the caller's household.</summary>
    private static async Task<bool> OwnedByTenantAsync(MiseDbContext db, string fileName, CancellationToken ct) =>
        await db.RecipeImages.AsNoTracking().AnyAsync(i => i.Path == fileName, ct)
        || await db.Recipes.AsNoTracking().AnyAsync(r => r.ImagePath == fileName, ct);

    private static IResult ServeImage(HttpContext ctx, string path)
    {
        var contentType = Path.GetExtension(path).ToLowerInvariant() switch
        {
            ".webp" => "image/webp",
            ".png" => "image/png",
            ".jpg" or ".jpeg" => "image/jpeg",
            _ => "application/octet-stream",
        };
        ctx.Response.Headers["X-Content-Type-Options"] = "nosniff";
        // Revalidate through the API guard; keep responses out of shared caches.
        ctx.Response.Headers.CacheControl = "private, no-cache";
        var info = new FileInfo(path);
        return Results.File(path, contentType, lastModified: info.LastWriteTimeUtc,
            entityTag: new Microsoft.Net.Http.Headers.EntityTagHeaderValue($"\"{info.Length:x}-{info.LastWriteTimeUtc.Ticks:x}\""));
    }
}
