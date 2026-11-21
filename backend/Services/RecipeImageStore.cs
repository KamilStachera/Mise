namespace Mise.Api.Services;

public sealed class InvalidImageException(string message) : Exception(message);

/// <summary>
/// Recipe photos on disk (a docker volume in production), served back via the
/// /api/images routes (originals and cached card thumbnails). Every upload is decoded and
/// re-encoded as WebP (fit inside <see cref="MaxStoredSize"/>, EXIF orientation applied and all
/// EXIF/GPS metadata stripped); invalid/spoofed uploads are rejected. Filenames carry a timestamp
/// plus random suffix so every upload gets a fresh URL and browser caches never show a stale photo.
/// </summary>
public class RecipeImageStore
{
    public const long MaxBytes = 5 * 1024 * 1024;
    public const int CardSize = 640;
    // One decode at a time bounds memory during a cold-cache burst of image requests.
    private readonly SemaphoreSlim variantsGate = new(1, 1);
    private string VariantsDir => Path.Combine(Root, "card-v1");

    private static readonly Dictionary<string, string> ExtByContentType = new(StringComparer.OrdinalIgnoreCase)
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

    /// <summary>Longest side of a re-encoded upload — the recipe page hero never shows more.</summary>
    public const int MaxStoredSize = 2048;
    public const int StoredQuality = 85;

    /// <summary>
    /// Validates, decodes, strips EXIF/GPS metadata, and stores an uploaded image as WebP.
    /// Throws <see cref="InvalidImageException"/> if the upload is not a valid decodable image.
    /// </summary>
    public async Task<string> SaveAsync(Guid recipeId, IFormFile file, CancellationToken ct = default)
    {
        if (!TryGetExtension(file.ContentType, out _))
            throw new InvalidImageException("Nieobsługiwany typ pliku — dozwolone JPG, PNG i WebP.");
        var temp = Path.Combine(Path.GetTempPath(), "pichci-upload-" + Guid.NewGuid().ToString("N"));
        try
        {
            await using (var target = File.Create(temp))
                await file.CopyToAsync(target, ct);
            return await SaveValidatedTempAsync(recipeId, temp, ct);
        }
        finally { if (File.Exists(temp)) File.Delete(temp); }
    }

    /// <summary>Validates, strips EXIF/GPS, and stores raw image bytes (e.g. fetched via SafeWebFetcher) as WebP.</summary>
    public async Task<string> SaveBytesAsync(Guid recipeId, byte[] bytes, CancellationToken ct = default)
    {
        if (bytes.Length is 0 or > (int)MaxBytes)
            throw new InvalidImageException("Plik musi mieć od 1 B do 5 MB.");
        var temp = Path.Combine(Path.GetTempPath(), "pichci-upload-" + Guid.NewGuid().ToString("N"));
        try
        {
            await File.WriteAllBytesAsync(temp, bytes, ct);
            return await SaveValidatedTempAsync(recipeId, temp, ct);
        }
        finally { if (File.Exists(temp)) File.Delete(temp); }
    }

    private async Task<string> SaveValidatedTempAsync(Guid recipeId, string tempSource, CancellationToken ct)
    {
        var name = $"{recipeId:N}-{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}-{Guid.NewGuid().ToString("N")[..8]}.webp";
        var destPath = Path.Combine(Root, name);
        await variantsGate.WaitAsync(ct);
        try
        {
            bool converted;
            try { converted = await Task.Run(() => ImageResizer.TryWriteWebp(tempSource, destPath, MaxStoredSize, StoredQuality), ct); }
            catch (Exception e) when (e is not OperationCanceledException) { converted = false; }
            if (!converted || !File.Exists(destPath))
            {
                if (File.Exists(destPath)) File.Delete(destPath);
                throw new InvalidImageException("Nie udało się odczytać zdjęcia — wgraj poprawny plik JPG, PNG lub WebP.");
            }
            return name;
        }
        finally { variantsGate.Release(); }
    }

    /// <summary>Safe path to an existing original in <see cref="Root"/>, or null when missing/unsafe.</summary>
    public string? GetOriginalPath(string fileName)
    {
        if (string.IsNullOrEmpty(fileName) || fileName != Path.GetFileName(fileName)) return null;
        var full = Path.Combine(Root, fileName);
        return File.Exists(full) ? full : null;
    }

    /// <summary>
    /// Copies a stored photo for another recipe (a new household's starter copy) — its own file,
    /// so deleting one household's photo never breaks the other's. Null when the source is gone.
    /// </summary>
    public string? CopyFor(Guid recipeId, string sourcePath)
    {
        if (string.IsNullOrWhiteSpace(sourcePath) || sourcePath != Path.GetFileName(sourcePath)) return null;
        var source = Path.Combine(Root, sourcePath);
        if (!File.Exists(source)) return null;
        var name = $"{recipeId:N}-{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}-{Guid.NewGuid().ToString("N")[..8]}{Path.GetExtension(sourcePath)}";
        File.Copy(source, Path.Combine(Root, name));
        return name;
    }

    /// <summary>
    /// Lazily builds a WebP card thumbnail for old and new uploads. Originals remain untouched.
    /// Invalid/oversized legacy images fall back to the original.
    /// </summary>
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

    public async Task DeleteAsync(string? imagePath, CancellationToken ct = default)
    {
        if (string.IsNullOrEmpty(imagePath) || imagePath != Path.GetFileName(imagePath)) return;
        await variantsGate.WaitAsync(ct);
        try { DeleteCore(imagePath); }
        finally { variantsGate.Release(); }
    }

    public void Delete(string? imagePath)
    {
        // Stored names are generated by us, but never let a stray path escape the root.
        if (string.IsNullOrEmpty(imagePath) || imagePath != Path.GetFileName(imagePath)) return;
        variantsGate.Wait();
        try { DeleteCore(imagePath); }
        finally { variantsGate.Release(); }
    }

    private void DeleteCore(string imagePath)
    {
        var full = Path.Combine(Root, imagePath);
        if (File.Exists(full)) File.Delete(full);
        var cached = Path.Combine(VariantsDir, imagePath + ".webp");
        if (File.Exists(cached)) File.Delete(cached);
    }
}
