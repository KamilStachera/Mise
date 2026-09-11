using SkiaSharp;

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

    /// <summary>Save the upload and return the stored filename; older photos stay on disk (gallery).</summary>
    public async Task<string> SaveAsync(Guid recipeId, IFormFile file, CancellationToken ct = default)
    {
        TryGetExtension(file.ContentType, out var ext);
        var name = $"{recipeId:N}-{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}{ext}";
        await using (var target = File.Create(Path.Combine(Root, name)))
            await file.CopyToAsync(target, ct);
        return name;
    }

    /// <summary>
    /// Lazily builds a WebP for old and new uploads. Originals remain untouched.
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
    {
        using var input = File.OpenRead(original);
        using var codec = SKCodec.Create(input);
        if (codec is null || (long)codec.Info.Width * codec.Info.Height > 40_000_000)
            return original;
        using var bitmap = SKBitmap.Decode(codec);
        if (bitmap is null) return original;
        var origin = codec.EncodedOrigin;
        var swap = (int)origin >= 5;
        var width = swap ? bitmap.Height : bitmap.Width;
        var height = swap ? bitmap.Width : bitmap.Height;
        var scale = Math.Min(1d, (double)CardSize / Math.Max(width, height));
        using var resized = new SKBitmap(Math.Max(1, (int)Math.Round(width * scale)),
            Math.Max(1, (int)Math.Round(height * scale)));
        using (var canvas = new SKCanvas(resized))
        {
            canvas.Clear(SKColors.Transparent);
            canvas.Scale((float)resized.Width / width, (float)resized.Height / height);
            // Apply EXIF orientation before dropping metadata from the derivative.
            switch (origin)
            {
                case SKEncodedOrigin.TopRight: canvas.Translate(width, 0); canvas.Scale(-1, 1); break;
                case SKEncodedOrigin.BottomRight: canvas.Translate(width, height); canvas.RotateDegrees(180); break;
                case SKEncodedOrigin.BottomLeft: canvas.Translate(0, height); canvas.Scale(1, -1); break;
                case SKEncodedOrigin.LeftTop: canvas.RotateDegrees(90); canvas.Scale(1, -1); break;
                case SKEncodedOrigin.RightTop: canvas.Translate(width, 0); canvas.RotateDegrees(90); break;
                case SKEncodedOrigin.RightBottom: canvas.Translate(width, height); canvas.RotateDegrees(90); canvas.Scale(-1, 1); break;
                case SKEncodedOrigin.LeftBottom: canvas.Translate(0, height); canvas.RotateDegrees(270); break;
            }
            using var image = SKImage.FromBitmap(bitmap);
            canvas.DrawImage(image, 0, 0, new SKSamplingOptions(SKFilterMode.Linear, SKMipmapMode.Linear));
        }
        using var encoded = resized.Encode(SKEncodedImageFormat.Webp, 78);
        if (encoded is null) return original;
        Directory.CreateDirectory(Path.GetDirectoryName(cached)!);
        var temp = cached + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            using (var output = File.Create(temp)) encoded.SaveTo(output);
            File.Move(temp, cached, overwrite: true);
        }
        finally { if (File.Exists(temp)) File.Delete(temp); }
        return cached;
    }

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
