using Mise.Api.Services;

namespace Mise.Api.Features;

public static class ImageEndpoints
{
    public static RouteGroupBuilder MapImages(this RouteGroupBuilder api)
    {
        api.MapGet("/images/{fileName}/card-v1.webp", async (string fileName,
            HttpContext ctx, RecipeImageStore store, ILogger<RecipeImageStore> logger) =>
        {
            if (fileName != Path.GetFileName(fileName)) return Results.NotFound();
            string? path;
            try { path = await store.GetCardAsync(fileName, ctx.RequestAborted); }
            catch (IOException ex)
            {
                logger.LogWarning(ex, "Could not generate recipe thumbnail for {FileName}", fileName);
                path = Path.Combine(store.Root, fileName);
            }
            if (path is null || !File.Exists(path)) return Results.NotFound();
            var contentType = Path.GetExtension(path).ToLowerInvariant() switch
            {
                ".webp" => "image/webp",
                ".png" => "image/png",
                ".jpg" or ".jpeg" => "image/jpeg",
                _ => "application/octet-stream",
            };
            // Revalidate through the API guard; keep responses out of shared caches.
            ctx.Response.Headers.CacheControl = "private, no-cache";
            var info = new FileInfo(path);
            return Results.File(path, contentType, lastModified: info.LastWriteTimeUtc,
                entityTag: new Microsoft.Net.Http.Headers.EntityTagHeaderValue($"\"{info.Length:x}-{info.LastWriteTimeUtc.Ticks:x}\""));
        }).WithTags("Recipes");
        return api;
    }
}
