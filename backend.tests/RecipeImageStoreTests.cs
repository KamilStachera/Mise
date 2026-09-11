using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;
using Mise.Api.Services;
using SkiaSharp;
using Xunit;

namespace Mise.Api.Tests;

public sealed class RecipeImageStoreTests : IDisposable
{
    private readonly string root = Path.Combine(Path.GetTempPath(), "pichci-images-test-" + Guid.NewGuid());
    private readonly RecipeImageStore store;

    public RecipeImageStoreTests()
    {
        store = new RecipeImageStore(new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["ImagesDir"] = root }).Build(), new TestEnvironment());
    }

    [Fact]
    public async Task ExistingLargePngGetsSmallCachedWebpWithoutChangingOriginal()
    {
        using var bitmap = new SKBitmap(1600, 1000);
        var random = new Random(42);
        var pixels = new SKColor[bitmap.Width * bitmap.Height];
        for (var i = 0; i < pixels.Length; i++)
            pixels[i] = new SKColor((byte)random.Next(256), (byte)random.Next(256), (byte)random.Next(256));
        bitmap.Pixels = pixels;
        var original = Save(bitmap, "large.png", SKEncodedImageFormat.Png);
        var before = await File.ReadAllBytesAsync(original);
        var results = await Task.WhenAll(Enumerable.Range(0, 8).Select(_ => store.GetCardAsync("large.png")));
        var cached = results[0]!;
        Assert.All(results, path => Assert.Equal(cached, path));
        using var decoded = SKBitmap.Decode(cached);
        Assert.Equal(640, decoded.Width);
        Assert.Equal(400, decoded.Height);
        Assert.True(new FileInfo(cached).Length < before.Length / 5);
        using var codec = SKCodec.Create(cached);
        Assert.Equal(SKEncodedImageFormat.Webp, codec.EncodedFormat);
        Assert.Equal(before, await File.ReadAllBytesAsync(original));
        var timestamp = File.GetLastWriteTimeUtc(cached);
        Assert.Equal(cached, await store.GetCardAsync("large.png"));
        Assert.Equal(timestamp, File.GetLastWriteTimeUtc(cached));
        Assert.Single(Directory.GetFiles(Path.GetDirectoryName(cached)!));
    }

    [Theory]
    [InlineData(SKEncodedImageFormat.Png, "small.png")]
    [InlineData(SKEncodedImageFormat.Webp, "small.webp")]
    public async Task SmallTransparentImagesAreNotUpscaled(SKEncodedImageFormat format, string name)
    {
        using var bitmap = new SKBitmap(32, 64);
        bitmap.Erase(SKColors.Transparent);
        Save(bitmap, name, format);
        using var result = SKBitmap.Decode(await store.GetCardAsync(name));
        Assert.Equal(32, result.Width);
        Assert.Equal(64, result.Height);
        Assert.Equal(0, result.GetPixel(0, 0).Alpha);
    }

    [Theory]
    [InlineData(1, false, false)]
    [InlineData(2, false, true)]
    [InlineData(3, false, true)]
    [InlineData(4, false, false)]
    [InlineData(5, true, false)]
    [InlineData(6, true, false)]
    [InlineData(7, true, true)]
    [InlineData(8, true, true)]
    public async Task JpegExifOrientationIsApplied(int orientation, bool swapped, bool blueFirst)
    {
        using var bitmap = new SKBitmap(80, 40);
        using (var canvas = new SKCanvas(bitmap))
        {
            canvas.Clear(SKColors.Red);
            using var paint = new SKPaint { Color = SKColors.Blue };
            canvas.DrawRect(40, 0, 40, 40, paint);
        }
        using var jpeg = bitmap.Encode(SKEncodedImageFormat.Jpeg, 100);
        var bytes = jpeg.ToArray();
        // APP1 with a little-endian TIFF containing just the orientation tag.
        byte[] exif = [0xff, 0xe1, 0, 34, 69, 120, 105, 102, 0, 0,
            73, 73, 42, 0, 8, 0, 0, 0, 1, 0, 18, 1, 3, 0,
            1, 0, 0, 0, (byte)orientation, 0, 0, 0, 0, 0, 0, 0];
        await File.WriteAllBytesAsync(Path.Combine(root, "phone.jpg"),
            bytes.Take(2).Concat(exif).Concat(bytes.Skip(2)).ToArray());
        using var result = SKBitmap.Decode(await store.GetCardAsync("phone.jpg"));
        Assert.Equal(swapped ? 40 : 80, result.Width);
        Assert.Equal(swapped ? 80 : 40, result.Height);
        var first = result.GetPixel(10, 10);
        Assert.True(blueFirst ? first.Blue > 200 && first.Red < 30 : first.Red > 200 && first.Blue < 30);
    }

    [Fact]
    public async Task MissingInvalidAndTraversalInputsAreHandled()
    {
        Assert.Null(await store.GetCardAsync("missing.png"));
        Assert.Null(await store.GetCardAsync("../outside.png"));
        Assert.Null(await store.GetCardAsync(""));
        var invalid = Path.Combine(root, "invalid.png");
        await File.WriteAllTextAsync(invalid, "not an image");
        Assert.Equal(invalid, await store.GetCardAsync("invalid.png"));
    }

    [Fact]
    public async Task DeleteRemovesOnlyTheOriginalAndItsDerivative()
    {
        using var bitmap = new SKBitmap(20, 20);
        bitmap.Erase(SKColors.Red);
        var original = Save(bitmap, "one.png", SKEncodedImageFormat.Png);
        var other = Save(bitmap, "two.png", SKEncodedImageFormat.Png);
        var cached = await store.GetCardAsync("one.png");
        var otherCached = await store.GetCardAsync("two.png");
        store.Delete("one.png");
        Assert.False(File.Exists(original));
        Assert.False(File.Exists(cached));
        Assert.True(File.Exists(other));
        Assert.True(File.Exists(otherCached));
        Assert.Null(await store.GetCardAsync("one.png"));
        store.Delete("one.png");
        store.Delete("../two.png");
        Assert.True(File.Exists(other));
    }

    private string Save(SKBitmap bitmap, string name, SKEncodedImageFormat format)
    {
        var path = Path.Combine(root, name);
        using var data = bitmap.Encode(format, 100);
        using var output = File.Create(path);
        data.SaveTo(output);
        return path;
    }

    public void Dispose() => Directory.Delete(root, recursive: true);

    private sealed class TestEnvironment : IHostEnvironment
    {
        public string EnvironmentName { get; set; } = "Testing";
        public string ApplicationName { get; set; } = "ImageTests";
        public string ContentRootPath { get; set; } = "";
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
    }
}
