namespace Mise.Api.Services;

/// <summary>
/// Recipe photos on disk (a docker volume in production), served back via the
/// /api/images routes (originals and cached card thumbnails). Filenames carry a timestamp so every upload
/// gets a fresh URL and browser caches never show a stale photo.
/// </summary>
public class RecipeImageStore
{
    public const long MaxBytes = 5 * 1024 * 1024;
    public const int CardSize = 640;
    // One decode at a time bounds memory during a cold-cache burst of image requests.
    private readonly SemaphoreSlim variantsGate = new(1, 1);
    private string VariantsDir => Path.Combine(Root, "card-v1");

    private static readonly Dictionary<string, string> ExtByContentType = new()
    {
        ["image/jpeg"] = ".jpg",
        ["image/png"] = ".png",
        ["image/webp"] = ".webp",
    };

    public static IReadOnlyCollection<string> AllowedContentTypes => ExtByContentType.Keys;

    public string Root { get; }

    public RecipeImageStore(IConfiguration cfg, IHostEnvironment env)
    {
        Root = cfg["ImagesDir"] ?? Path.Combine(env.ContentRootPath, "data", "images");
        Directory.CreateDirectory(Root);
    }

    public static bool TryGetExtension(string? contentType, out string ext)
        => ExtByContentType.TryGetValue(contentType ?? "", out ext!);

    /// <summary>Uploads above this are re-encoded as WebP (phone photos, ~3 MB AI-generated PNGs).</summary>
    public const long OptimizeAboveBytes = 1024 * 1024;
    /// <summary>Longest side of a re-encoded upload — the recipe page hero never shows more.</summary>
    public const int MaxStoredSize = 2048;
    public const int StoredQuality = 85;

    /// <summary>
    /// Save the upload and return the stored filename; older photos stay on disk (gallery).
    /// Big uploads are stored as WebP (fit in <see cref="MaxStoredSize"/>, EXIF orientation applied);
    /// small ones, undecodable ones and ones WebP wouldn't shrink are stored byte for byte.
    /// </summary>
    public async Task<string> SaveAsync(Guid recipeId, IFormFile file, CancellationToken ct = default)
    {
        TryGetExtension(file.ContentType, out var ext);
        var stem = $"{recipeId:N}-{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}";
        var name = stem + ext;
        var path = Path.Combine(Root, name);
        await using (var target = File.Create(path))
            await file.CopyToAsync(target, ct);

        if (file.Length <= OptimizeAboveBytes) return name;

        var webpName = stem + ".webp";
        // A big WebP is re-encoded beside itself first — never write over the file being read.
        var webpPath = Path.Combine(Root, webpName) + (ext == ".webp" ? ".opt" : "");
        // Same gate as the card thumbnails: one full-size decode in memory at a time.
        await variantsGate.WaitAsync(ct);
        try
        {
            bool converted;
            try { converted = await Task.Run(() => ImageResizer.TryWriteWebp(path, webpPath, MaxStoredSize, StoredQuality), ct); }
            catch (Exception e) when (e is not OperationCanceledException) { converted = false; }
            if (!converted || new FileInfo(webpPath).Length >= file.Length)
            {
                if (File.Exists(webpPath)) File.Delete(webpPath);
                return name; // keep the upload as it came
            }
            if (ext == ".webp") File.Move(webpPath, path, overwrite: true);
            else File.Delete(path);
            return webpName;
        }
        finally { variantsGate.Release(); }
    }

    /// <summary>
    /// Lazily builds a WebP for old and new uploads. Originals remain untouched.
    /// Invalid/oversized legacy images fall back to the original.
    /// </summary>
    /// <summary>
    /// Copies a stored photo for another recipe (a new household's starter copy) — its own file,
    /// so deleting one household's photo never breaks the other's. Null when the source is gone.
    /// </summary>
    public string? CopyFor(Guid recipeId, string sourcePath)
    {
        if (string.IsNullOrWhiteSpace(sourcePath) || sourcePath.Contains("..") || Path.IsPathRooted(sourcePath)) return null;
        var source = Path.Combine(Root, sourcePath);
        if (!File.Exists(source)) return null;
        var name = $"{recipeId:N}-{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}-{Guid.NewGuid().ToString("N")[..8]}{Path.GetExtension(sourcePath)}";
        File.Copy(source, Path.Combine(Root, name));
        return name;
    }

    public async Task<string?> GetCardAsync(string fileName, CancellationToken ct = default)
    {
        if (string.IsNullOrEmpty(fileName) || fileName != Path.GetFileName(fileName)) return null;
        var original = Path.Combine(Root, fileName);
        var cached = Path.Combine(VariantsDir, fileName + ".webp");
        if (!File.Exists(original)) return null;
        if (File.Exists(cached)) return cached;
        await variantsGate.WaitAsync(ct);
        try
        {
            if (!File.Exists(original)) return null;
            if (File.Exists(cached)) return cached;
            return await Task.Run(() => BuildCard(original, cached), ct);
        }
        finally { variantsGate.Release(); }
    }

    private static string BuildCard(string original, string cached)
        => ImageResizer.TryWriteWebp(original, cached, CardSize) ? cached : original;

    public void Delete(string? imagePath)
    {
        // Stored names are generated by us, but never let a stray path escape the root.
        if (string.IsNullOrEmpty(imagePath) || imagePath != Path.GetFileName(imagePath)) return;
        variantsGate.Wait();
        try
        {
            var full = Path.Combine(Root, imagePath);
            if (File.Exists(full)) File.Delete(full);
            var cached = Path.Combine(VariantsDir, imagePath + ".webp");
            if (File.Exists(cached)) File.Delete(cached);
        }
        finally { variantsGate.Release(); }
    }
}
