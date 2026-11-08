using SkiaSharp;

namespace Mise.Api.Services;

/// <summary>
/// Shared "fit inside N px and encode as WebP" step for recipe cards and exercise photos.
/// Applies EXIF orientation, refuses absurd dimensions, writes atomically (temp + move).
/// </summary>
public static class ImageResizer
{
    /// <summary>Writes <paramref name="target"/> and returns true; false when the input can't be decoded.</summary>
    public static bool TryWriteWebp(string source, string target, int maxSize, int quality = 78)
    {
        using var input = File.OpenRead(source);
        using var codec = SKCodec.Create(input);
        if (codec is null || (long)codec.Info.Width * codec.Info.Height > 40_000_000) return false;
        using var bitmap = SKBitmap.Decode(codec);
        if (bitmap is null) return false;
        var origin = codec.EncodedOrigin;
        var swap = (int)origin >= 5;
        var width = swap ? bitmap.Height : bitmap.Width;
        var height = swap ? bitmap.Width : bitmap.Height;
        var scale = Math.Min(1d, (double)maxSize / Math.Max(width, height));
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
        using var encoded = resized.Encode(SKEncodedImageFormat.Webp, quality);
        if (encoded is null) return false;
        Directory.CreateDirectory(Path.GetDirectoryName(target)!);
        var temp = target + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            using (var output = File.Create(temp)) encoded.SaveTo(output);
            File.Move(temp, target, overwrite: true);
        }
        finally { if (File.Exists(temp)) File.Delete(temp); }
        return true;
    }
}
