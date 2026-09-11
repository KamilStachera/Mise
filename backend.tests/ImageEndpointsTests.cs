using System.Net;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.FileProviders;
using Mise.Api.Features;
using Mise.Api.Services;
using SkiaSharp;
using Xunit;

namespace Mise.Api.Tests;

public class ImageEndpointsTests
{
    [Fact]
    public async Task ThumbnailRouteCoexistsWithOriginalsAndRevalidatesCachedBytes()
    {
        var root = Path.Combine(Path.GetTempPath(), "pichci-image-http-test-" + Guid.NewGuid());
        Directory.CreateDirectory(root);
        try
        {
            var builder = WebApplication.CreateBuilder();
            builder.WebHost.UseTestServer();
            builder.Configuration["ImagesDir"] = root;
            builder.Services.AddSingleton<RecipeImageStore>();
            builder.Services.AddSingleton<AccessControl>();
            await using var app = builder.Build();
            app.UseMiddleware<ApiAccessMiddleware>();
            using var provider = new PhysicalFileProvider(root);
            app.UseStaticFiles(new StaticFileOptions { FileProvider = provider, RequestPath = "/api/images" });
            app.MapGroup("/api").MapImages();
            await app.StartAsync();
            using var client = app.GetTestClient();
            using (var bitmap = new SKBitmap(1200, 800))
            {
                bitmap.Erase(SKColors.Green);
                using var data = bitmap.Encode(SKEncodedImageFormat.Png, 100);
                await File.WriteAllBytesAsync(Path.Combine(root, "recipe.png"), data.ToArray());
            }
            var original = await client.GetAsync("/api/images/recipe.png");
            Assert.Equal("image/png", original.Content.Headers.ContentType?.MediaType);
            const string url = "/api/images/recipe.png/card-v1.webp";
            var thumbnail = await client.GetAsync(url);
            Assert.Equal(HttpStatusCode.OK, thumbnail.StatusCode);
            Assert.Equal("image/webp", thumbnail.Content.Headers.ContentType?.MediaType);
            Assert.True(thumbnail.Headers.CacheControl?.Private);
            using var decoded = SKBitmap.Decode(await thumbnail.Content.ReadAsByteArrayAsync());
            Assert.Equal(640, decoded.Width);
            var conditional = new HttpRequestMessage(HttpMethod.Get, url);
            conditional.Headers.IfNoneMatch.Add(thumbnail.Headers.ETag!);
            var unchanged = await client.SendAsync(conditional);
            Assert.Equal(HttpStatusCode.NotModified, unchanged.StatusCode);
            Assert.Empty(await unchanged.Content.ReadAsByteArrayAsync());
            Assert.Equal(HttpStatusCode.NotFound,
                (await client.GetAsync("/api/images/missing.png/card-v1.webp")).StatusCode);
            app.Services.GetRequiredService<RecipeImageStore>().Delete("recipe.png");
            Assert.Equal(HttpStatusCode.NotFound, (await client.SendAsync(new HttpRequestMessage(HttpMethod.Get, url))).StatusCode);
        }
        finally { Directory.Delete(root, recursive: true); }
    }
}
