using System.Net;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Mise.Api.Data;
using Mise.Api.Domain;
using Mise.Api.Features;
using Mise.Api.Services;
using SkiaSharp;
using Xunit;

namespace Mise.Api.Tests;

public class ImageEndpointsTests
{
    [Fact]
    public async Task ThumbnailRouteCoexistsWithOriginalsAndEnforcesTenantOwnership()
    {
        var root = Path.Combine(Path.GetTempPath(), "pichci-image-http-test-" + Guid.NewGuid());
        Directory.CreateDirectory(root);
        try
        {
            var dbName = Guid.NewGuid().ToString();
            var builder = WebApplication.CreateBuilder();
            builder.WebHost.UseTestServer();
            builder.Configuration["ImagesDir"] = root;
            builder.Configuration["Auth:PublicHouseholdId"] = "1";
            builder.Services.AddSingleton<RecipeImageStore>();
            builder.Services.AddSingleton<AccessControl>();
            builder.Services.AddTenancy();
            builder.Services.AddDbContext<MiseDbContext>(o => o.UseInMemoryDatabase(dbName));
            await using var app = builder.Build();
            app.UseMiddleware<ApiAccessMiddleware>();
            app.MapGroup("/api").MapImages();
            await app.StartAsync();

            using (var scope = app.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<MiseDbContext>();
                db.Tenant.UseSystem();
                db.Households.AddRange(new Household { Id = 1, Name = "Dom 1" }, new Household { Id = 2, Name = "Dom 2" });
                db.People.AddRange(
                    new Person { Id = 1, HouseholdId = 1, Name = "A" },
                    new Person { Id = 2, HouseholdId = 2, Name = "B" });
                db.Recipes.AddRange(
                    new Recipe { HouseholdId = 1, Title = "Public", ImagePath = "recipe.png" },
                    new Recipe { HouseholdId = 2, Title = "Private", ImagePath = "secret.png" });
                await db.SaveChangesAsync();
            }

            using var client = app.GetTestClient();
            using (var bitmap = new SKBitmap(1200, 800))
            {
                bitmap.Erase(SKColors.Green);
                using var data = bitmap.Encode(SKEncodedImageFormat.Png, 100);
                var png = data.ToArray();
                await File.WriteAllBytesAsync(Path.Combine(root, "recipe.png"), png);
                await File.WriteAllBytesAsync(Path.Combine(root, "secret.png"), png);
            }

            var original = await client.GetAsync("/api/images/recipe.png");
            Assert.Equal(HttpStatusCode.OK, original.StatusCode);
            Assert.Equal("image/png", original.Content.Headers.ContentType?.MediaType);
            Assert.Equal("nosniff", original.Headers.GetValues("X-Content-Type-Options").Single());

            // Another household's photo is invisible to anonymous/public household 1 visitors.
            Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/images/secret.png")).StatusCode);
            Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/images/secret.png/card-v1.webp")).StatusCode);

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
