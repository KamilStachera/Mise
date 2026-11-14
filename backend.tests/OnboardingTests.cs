using System.Net;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Mise.Api.Data;
using Mise.Api.Domain;
using Mise.Api.Features;
using Mise.Api.Services;
using Xunit;

namespace Mise.Api.Tests;

/// <summary>Invite codes end to end: admin creates a household code, a friend redeems it, their partner joins.</summary>
public sealed class OnboardingTests : IAsyncLifetime
{
    private const string Admin = "kamil@example.com", Partner = "ania@example.com", Friend = "friend@example.com";
    private readonly string _db = Guid.NewGuid().ToString();
    private readonly string _root = Path.Combine(Path.GetTempPath(), "pichci-onboarding-" + Guid.NewGuid());
    private WebApplication _app = null!;
    private HttpClient _client = null!;

    public async Task InitializeAsync()
    {
        Directory.CreateDirectory(Path.Combine(_root, "images"));
        await File.WriteAllBytesAsync(Path.Combine(_root, "images", "photo.jpg"), [1, 2, 3]);
        await using (var db = Db(TenantContext.System()))
        {
            db.Households.Add(new Household { Id = 1, Name = "Dom", SousEnabled = true });
            db.People.AddRange(
                new Person { Id = 1, HouseholdId = 1, Name = "Ania", Email = Partner },
                new Person { Id = 2, HouseholdId = 1, Name = "Kamil", Email = Admin });
            var eggs = new PantryItem { HouseholdId = 1, Name = "Czosnek", Quantity = 3 };
            db.PantryItems.Add(eggs);
            db.Recipes.AddRange(
                new Recipe
                {
                    HouseholdId = 1, Title = "Pierogi", SourceName = "Blond Kuchara", ImagePath = "photo.jpg",
                    Images = [new RecipeImage { Path = "photo.jpg" }],
                    Ingredients = [new RecipeIngredient { Name = "czosnek", Quantity = "2 szt", PantryItem = eggs }],
                    Steps = [new RecipeStep { Order = 0, Text = "Ulep." }],
                },
                new Recipe { HouseholdId = 1, Title = "Zupa", SourceName = "Blond Kuchara" },
                new Recipe { HouseholdId = 1, Title = "Owsianka", SourceName = "Daily Dieta" });
            await db.SaveChangesAsync();
        }

        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseTestServer();
        builder.Configuration["Auth:AdminEmails"] = Admin;
        builder.Configuration["ImagesDir"] = Path.Combine(_root, "images");
        builder.Configuration["ContextDir"] = Path.Combine(_root, "context");
        builder.Services.AddDbContext<MiseDbContext>(o => o.UseInMemoryDatabase(_db));
        builder.Services.AddSingleton<AccessControl>();
        builder.Services.AddTenancy();
        builder.Services.AddScoped<IngredientMatcher>();
        builder.Services.AddSingleton<RecipeImageStore>();
        builder.Services.AddSingleton<CookbookMarkdownBuilder>();
        builder.Services.AddScoped<ContextExportService>();
        builder.Services.AddScoped<HouseholdProvisioner>();
        builder.Services.AddHouseholdRateLimits();
        _app = builder.Build();
        // Stand-in for the Google cookie: the test names the signed-in email in a header.
        _app.Use(async (ctx, next) =>
        {
            if (ctx.Request.Headers["X-Test-Email"].ToString() is { Length: > 0 } email)
                ctx.User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.Email, email)], "test"));
            await next(ctx);
        });
        _app.UseMiddleware<ApiAccessMiddleware>();
        _app.UseRateLimiter();
        var api = _app.MapGroup("/api");
        api.MapAuth();
        api.MapHouseholds();
        api.MapAdmin();
        api.MapKeys();
        api.MapGet("/recipes", (MiseDbContext db) => db.Recipes.OrderBy(r => r.Title).Select(r => r.Title).ToListAsync());
        await _app.StartAsync();
        _client = _app.GetTestClient();
    }

    public async Task DisposeAsync()
    {
        await _app.DisposeAsync();
        try { Directory.Delete(_root, recursive: true); } catch (IOException) { }
    }

    [Fact]
    public async Task FriendRedeemsAHouseholdCode_GetsAPrivateStarterCopy_AndInvitesTheirPartner()
    {
        // Only the admin creates households.
        Assert.Equal(HttpStatusCode.Forbidden, (await Send(HttpMethod.Post, "/api/admin/invites", Partner, new { starter = "all" })).StatusCode);
        var code = await CodeAsync(await Send(HttpMethod.Post, "/api/admin/invites", Admin,
            new { householdName = "Znajomi", starter = "sources", sources = new[] { "Blond Kuchara" } }));

        // A Google account outside every household is "unlinked" until it redeems.
        var me = await Json(await Send(HttpMethod.Get, "/api/auth/me", Friend));
        Assert.True(me.GetProperty("needsOnboarding").GetBoolean());
        Assert.False(me.GetProperty("authenticated").GetBoolean());
        Assert.Equal(HttpStatusCode.Forbidden, (await Send(HttpMethod.Get, "/api/recipes", Friend)).StatusCode);

        Assert.Equal(HttpStatusCode.BadRequest, (await Redeem(Friend, "AAAAA-AAAAA", "Ola")).StatusCode);
        // Forgiving input: lower case, no dash.
        var redeemed = await Redeem(Friend, code.Replace("-", "").ToLowerInvariant(), "Ola");
        Assert.Equal(HttpStatusCode.OK, redeemed.StatusCode);

        me = await Json(await Send(HttpMethod.Get, "/api/auth/me", Friend));
        Assert.True(me.GetProperty("authenticated").GetBoolean());
        Assert.Equal("Znajomi", me.GetProperty("household").GetProperty("name").GetString());
        Assert.False(me.GetProperty("household").GetProperty("sousEnabled").GetBoolean());
        Assert.False(me.GetProperty("isAdmin").GetBoolean());

        // Their own copy of the chosen source; the owner's household is untouched.
        Assert.Equal("[\"Pierogi\",\"Zupa\"]", await (await Send(HttpMethod.Get, "/api/recipes", Friend)).Content.ReadAsStringAsync());
        Assert.Equal("[\"Owsianka\",\"Pierogi\",\"Zupa\"]", await (await Send(HttpMethod.Get, "/api/recipes", Admin)).Content.ReadAsStringAsync());
        await using (var db = Db(TenantContext.For(2)))
        {
            var copy = await db.Recipes.Include(r => r.Ingredients).Include(r => r.Images).Include(r => r.Steps)
                .SingleAsync(r => r.Title == "Pierogi");
            Assert.NotEqual("photo.jpg", copy.ImagePath);
            Assert.True(File.Exists(Path.Combine(_root, "images", copy.ImagePath!)));
            Assert.Equal(copy.ImagePath, Assert.Single(copy.Images).Path);
            Assert.Equal("Ulep.", Assert.Single(copy.Steps).Text);
            // Relinked to the new household's own (seeded) pantry, never the owner's.
            var link = Assert.Single(copy.Ingredients).PantryItemId;
            Assert.NotNull(link);
            Assert.Equal("Czosnek", (await db.PantryItems.SingleAsync(p => p.Id == link)).Name);
            Assert.Single(await db.Preferences.ToListAsync());
        }
        Assert.True(File.Exists(Path.Combine(_root, "context", "2", "cookbook.md")));

        // Single use.
        Assert.Equal(HttpStatusCode.BadRequest, (await Redeem("someone@example.com", code, "Ktoś")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Redeem(Friend, code, "Ola")).StatusCode);

        // The friend invites their partner into their own household.
        var join = await CodeAsync(await Send(HttpMethod.Post, "/api/household/invites", Friend));
        Assert.Equal(HttpStatusCode.OK, (await Redeem("partner@example.com", join, "Piotr")).StatusCode);
        var household = await Json(await Send(HttpMethod.Get, "/api/household", "partner@example.com"));
        Assert.Equal(["Ola", "Piotr"], household.GetProperty("members").EnumerateArray().Select(m => m.GetProperty("name").GetString()));
        Assert.Equal(["Dom"], [(await Json(await Send(HttpMethod.Get, "/api/household", Admin))).GetProperty("name").GetString()]);
        Assert.Equal(2, (await Json(await Send(HttpMethod.Get, "/api/household", Admin))).GetProperty("members").GetArrayLength());

        // Sous is the admin's to switch on.
        Assert.Equal(HttpStatusCode.Forbidden, (await Send(HttpMethod.Patch, "/api/admin/households/2", Friend, new { sousEnabled = true })).StatusCode);
        var row = await Json(await Send(HttpMethod.Patch, "/api/admin/households/2", Admin, new { sousEnabled = true }));
        Assert.True(row.GetProperty("sousEnabled").GetBoolean());
        Assert.Equal(2, row.GetProperty("recipes").GetInt32());
        var overview = await Json(await Send(HttpMethod.Get, "/api/admin/overview", Admin));
        Assert.Contains(overview.GetProperty("sources").EnumerateArray(), s => s.GetProperty("name").GetString() == "Blond Kuchara");
    }

    [Fact]
    public async Task ExpiredCodes_AreRejected_AndRedeemIsRateLimited()
    {
        var code = await CodeAsync(await Send(HttpMethod.Post, "/api/household/invites", Admin));
        await using (var db = Db(TenantContext.System()))
        {
            var invite = await db.InviteCodes.SingleAsync();
            invite.ExpiresAt = DateTimeOffset.UtcNow.AddMinutes(-1);
            await db.SaveChangesAsync();
        }
        Assert.Equal(HttpStatusCode.BadRequest, (await Redeem("late@example.com", code, "Spóźniony")).StatusCode);

        for (var i = 0; i < 4; i++) await Redeem("late@example.com", "BBBBB-BBBBB", "x");
        Assert.Equal(HttpStatusCode.TooManyRequests, (await Redeem("late@example.com", "BBBBB-BBBBB", "x")).StatusCode);
        // Anonymous visitors can't redeem (they must sign in first).
        Assert.Equal(HttpStatusCode.BadRequest, (await Redeem(null, code, "x")).StatusCode);
    }

    [Fact]
    public async Task PersonalKeys_ActAsTheirPerson_UntilRevoked()
    {
        var created = await Json(await Send(HttpMethod.Post, "/api/keys", Partner, new { name = "Codex na laptopie" }));
        var key = created.GetProperty("key").GetString()!;
        Assert.StartsWith("pk_", key);

        var request = new HttpRequestMessage(HttpMethod.Get, "/api/auth/me");
        request.Headers.Add("X-Api-Key", key);
        var me = await Json(await _client.SendAsync(request));
        Assert.Equal(1, me.GetProperty("personId").GetInt32());
        Assert.Equal("Dom", me.GetProperty("household").GetProperty("name").GetString());

        // Listed for its owner only, never with the secret.
        var listed = await Send(HttpMethod.Get, "/api/keys", Partner);
        Assert.DoesNotContain(key, await listed.Content.ReadAsStringAsync());
        Assert.Equal("[]", await (await Send(HttpMethod.Get, "/api/keys", Admin)).Content.ReadAsStringAsync());
        Assert.Equal(HttpStatusCode.NotFound,
            (await Send(HttpMethod.Delete, $"/api/keys/{created.GetProperty("id").GetString()}", Admin)).StatusCode);

        Assert.Equal(HttpStatusCode.NoContent,
            (await Send(HttpMethod.Delete, $"/api/keys/{created.GetProperty("id").GetString()}", Partner)).StatusCode);
        var revoked = new HttpRequestMessage(HttpMethod.Post, "/api/household/invites");
        revoked.Headers.Add("X-Api-Key", key);
        Assert.Equal(HttpStatusCode.Unauthorized, (await _client.SendAsync(revoked)).StatusCode);
    }

    private MiseDbContext Db(TenantContext tenant) =>
        new(new DbContextOptionsBuilder<MiseDbContext>().UseInMemoryDatabase(_db).Options, tenant);

    private Task<HttpResponseMessage> Redeem(string? email, string code, string name) =>
        Send(HttpMethod.Post, "/api/onboarding/redeem", email, new { code, name });

    private async Task<HttpResponseMessage> Send(HttpMethod method, string path, string? email, object? body = null)
    {
        var request = new HttpRequestMessage(method, path);
        if (email is not null) request.Headers.Add("X-Test-Email", email);
        if (body is not null) request.Content = JsonContent.Create(body);
        return await _client.SendAsync(request);
    }

    private static async Task<JsonElement> Json(HttpResponseMessage response)
    {
        Assert.True(response.IsSuccessStatusCode, $"{(int)response.StatusCode}: {await response.Content.ReadAsStringAsync()}");
        return JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement;
    }

    private static async Task<string> CodeAsync(HttpResponseMessage response) =>
        (await Json(response)).GetProperty("code").GetString()!;
}
