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

/// <summary>The admin panel, roles and blocking — end to end through the real middleware and endpoints.</summary>
public sealed class AdminTests : IAsyncLifetime
{
    // Household 1 "Dom": Kamil (env admin, owner), Ania (owner). Household 2 "Znajomi": Ola (owner), Piotr (member).
    private const string Kamil = "kamil@example.com", Ania = "ania@example.com", Ola = "ola@example.com", Piotr = "piotr@example.com";
    private readonly string _db = Guid.NewGuid().ToString();
    private readonly string _root = Path.Combine(Path.GetTempPath(), "pichci-admin-" + Guid.NewGuid());
    private WebApplication _app = null!;
    private HttpClient _client = null!;

    public async Task InitializeAsync()
    {
        await using (var db = Db(TenantContext.System()))
        {
            db.Households.AddRange(new Household { Id = 1, Name = "Dom", SousEnabled = true }, new Household { Id = 2, Name = "Znajomi" });
            db.People.AddRange(
                new Person { Id = 1, HouseholdId = 1, Name = "Ania", Email = Ania, Role = HouseholdRole.Owner },
                new Person { Id = 2, HouseholdId = 1, Name = "Kamil", Email = Kamil, Role = HouseholdRole.Owner },
                new Person { Id = 3, HouseholdId = 2, Name = "Ola", Email = Ola, Role = HouseholdRole.Owner },
                new Person { Id = 4, HouseholdId = 2, Name = "Piotr", Email = Piotr, Role = HouseholdRole.Member });
            db.Recipes.Add(new Recipe { HouseholdId = 2, Title = "Pierogi" });
            await db.SaveChangesAsync();
        }

        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseTestServer();
        builder.Configuration["Auth:AdminEmails"] = Kamil;
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
        api.MapGet("/recipes", (MiseDbContext db) => db.Recipes.Select(r => r.Title).ToListAsync());
        await _app.StartAsync();
        _client = _app.GetTestClient();
    }

    public async Task DisposeAsync()
    {
        await _app.DisposeAsync();
        try { Directory.Delete(_root, recursive: true); } catch (IOException) { }
    }

    [Fact]
    public async Task OnlyAdmins_ReachThePanel_AndAPromotedAdminCanToo()
    {
        foreach (var path in new[] { "/api/admin/overview", "/api/admin/households", "/api/admin/people", "/api/admin/invites", "/api/admin/keys", "/api/admin/audit" })
        {
            Assert.Equal(HttpStatusCode.Forbidden, (await Send(HttpMethod.Get, path, Ola)).StatusCode);
            Assert.Equal(HttpStatusCode.OK, (await Send(HttpMethod.Get, path, Kamil)).StatusCode);
        }

        // Lists span households.
        var people = await Json(await Send(HttpMethod.Get, "/api/admin/people", Kamil));
        Assert.Equal(4, people.GetArrayLength());
        var households = await Json(await Send(HttpMethod.Get, "/api/admin/households", Kamil));
        Assert.Equal(1, households.EnumerateArray().Single(h => h.GetProperty("id").GetInt32() == 2).GetProperty("recipes").GetInt32());

        await Json(await Send(HttpMethod.Patch, "/api/admin/people/3", Kamil, new { isAdmin = true }));
        Assert.True((await Json(await Send(HttpMethod.Get, "/api/auth/me", Ola))).GetProperty("isAdmin").GetBoolean());
        Assert.Equal(HttpStatusCode.OK, (await Send(HttpMethod.Get, "/api/admin/overview", Ola)).StatusCode);

        // The env admin can't be demoted; nobody can demote or block themselves.
        Assert.Equal(HttpStatusCode.BadRequest, (await Send(HttpMethod.Patch, "/api/admin/people/2", Ola, new { isAdmin = false })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Send(HttpMethod.Patch, "/api/admin/people/3", Ola, new { isAdmin = false })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Send(HttpMethod.Patch, "/api/admin/people/2", Kamil, new { blocked = true })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Send(HttpMethod.Patch, "/api/admin/households/1", Kamil, new { blocked = true })).StatusCode);

        // Kamil may demote Ola again (an env admin remains).
        await Json(await Send(HttpMethod.Patch, "/api/admin/people/3", Kamil, new { isAdmin = false }));
        Assert.Equal(HttpStatusCode.Forbidden, (await Send(HttpMethod.Get, "/api/admin/overview", Ola)).StatusCode);
        Assert.Contains(await AuditKindsAsync(), k => k == "admin.granted");
        Assert.Contains(await AuditKindsAsync(), k => k == "admin.revoked");
    }

    [Fact]
    public async Task BlockingAPerson_ShutsTheirSessionAndKeys_UntilUnblocked()
    {
        var key = (await Json(await Send(HttpMethod.Post, "/api/keys", Piotr, new { name = "agent" }))).GetProperty("key").GetString()!;
        Assert.Equal(HttpStatusCode.OK, (await WithKey(key, "/api/recipes")).StatusCode);

        await Json(await Send(HttpMethod.Patch, "/api/admin/people/4", Kamil, new { blocked = true }));
        var denied = await Send(HttpMethod.Get, "/api/recipes", Piotr);
        Assert.Equal(HttpStatusCode.Forbidden, denied.StatusCode);
        Assert.True(JsonDocument.Parse(await denied.Content.ReadAsStringAsync()).RootElement.GetProperty("blocked").GetBoolean());
        Assert.True((await Json(await Send(HttpMethod.Get, "/api/auth/me", Piotr))).GetProperty("blocked").GetBoolean());
        Assert.Equal(HttpStatusCode.Forbidden, (await WithKey(key, "/api/recipes")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Send(HttpMethod.Get, "/api/recipes", Ola)).StatusCode);   // the rest of the house is fine

        await Json(await Send(HttpMethod.Patch, "/api/admin/people/4", Kamil, new { blocked = false }));
        Assert.Equal(HttpStatusCode.OK, (await Send(HttpMethod.Get, "/api/recipes", Piotr)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await WithKey(key, "/api/recipes")).StatusCode);

        // A blocked household blocks everyone in it.
        await Json(await Send(HttpMethod.Patch, "/api/admin/households/2", Kamil, new { blocked = true }));
        Assert.Equal(HttpStatusCode.Forbidden, (await Send(HttpMethod.Get, "/api/recipes", Ola)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await Send(HttpMethod.Get, "/api/recipes", Piotr)).StatusCode);
        await Json(await Send(HttpMethod.Patch, "/api/admin/households/2", Kamil, new { blocked = false }));
        Assert.Equal(HttpStatusCode.OK, (await Send(HttpMethod.Get, "/api/recipes", Ola)).StatusCode);

        var kinds = await AuditKindsAsync();
        Assert.Contains("person.blocked", kinds);
        Assert.Contains("person.unblocked", kinds);
        Assert.Contains("household.blocked", kinds);
    }

    [Fact]
    public async Task Unlinking_SendsTheAccountBackToOnboarding_AndKeepsTheData()
    {
        var key = (await Json(await Send(HttpMethod.Post, "/api/keys", Piotr, new { name = "agent" }))).GetProperty("key").GetString()!;
        var person = await Json(await Send(HttpMethod.Post, "/api/admin/people/4/unlink", Kamil));
        Assert.Equal(JsonValueKind.Null, person.GetProperty("email").ValueKind);

        Assert.True((await Json(await Send(HttpMethod.Get, "/api/auth/me", Piotr))).GetProperty("needsOnboarding").GetBoolean());
        Assert.Equal(HttpStatusCode.Unauthorized, (await WithKey(key, "/api/household/invites", HttpMethod.Post)).StatusCode);
        var members = (await Json(await Send(HttpMethod.Get, "/api/household", Ola))).GetProperty("members");
        Assert.Contains(members.EnumerateArray(), m => m.GetProperty("name").GetString() == "Piotr");

        Assert.Equal(HttpStatusCode.BadRequest, (await Send(HttpMethod.Post, "/api/admin/people/2/unlink", Kamil)).StatusCode);
        Assert.Contains("person.unlinked", await AuditKindsAsync());
    }

    [Fact]
    public async Task Owners_ManageTheirHousehold_MembersCant()
    {
        Assert.Equal(HttpStatusCode.Forbidden, (await Send(HttpMethod.Post, "/api/household/invites", Piotr)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await Send(HttpMethod.Patch, "/api/household", Piotr, new { name = "Moje" })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await Send(HttpMethod.Patch, "/api/household/people/3", Piotr, new { name = "X" })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Send(HttpMethod.Patch, "/api/household/people/4", Piotr, new { name = "Piotrek" })).StatusCode);
        var detail = await Json(await Send(HttpMethod.Get, "/api/household", Piotr));
        Assert.False(detail.GetProperty("canManage").GetBoolean());

        Assert.Equal(HttpStatusCode.OK, (await Send(HttpMethod.Post, "/api/household/invites", Ola)).StatusCode);
        // The last owner can't step down; promote Piotr first, then she can.
        Assert.Equal(HttpStatusCode.BadRequest, (await Send(HttpMethod.Patch, "/api/household/people/3/role", Ola, new { role = "member" })).StatusCode);
        await Json(await Send(HttpMethod.Patch, "/api/household/people/4/role", Ola, new { role = "owner" }));
        await Json(await Send(HttpMethod.Patch, "/api/household/people/3/role", Ola, new { role = "member" }));
        Assert.True((await Json(await Send(HttpMethod.Get, "/api/household", Piotr))).GetProperty("canManage").GetBoolean());
        Assert.Contains("role.changed", await AuditKindsAsync());
    }

    [Fact]
    public async Task Codes_History_Revoke_Extend_AndRoleGrants()
    {
        // An admin issues an owner join code for someone else's household.
        var ownerCode = await CodeAsync(await Send(HttpMethod.Post, "/api/admin/invites", Kamil, new { kind = "join", householdId = 2, role = "owner" }));
        Assert.Equal(HttpStatusCode.OK, (await Redeem("ewa@example.com", ownerCode, "Ewa")).StatusCode);
        var ewa = (await Json(await Send(HttpMethod.Get, "/api/admin/people?q=ewa", Kamil)))[0];
        Assert.Equal("owner", ewa.GetProperty("role").GetString());
        Assert.Equal("Znajomi", ewa.GetProperty("householdName").GetString());

        var revoked = await Json(await Send(HttpMethod.Post, "/api/admin/invites", Kamil, new { kind = "join", householdId = 1 }));
        Assert.Equal(HttpStatusCode.NoContent, (await Send(HttpMethod.Delete, $"/api/admin/invites/{revoked.GetProperty("id").GetString()}", Kamil)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Redeem("late@example.com", revoked.GetProperty("code").GetString()!, "Late")).StatusCode);

        var expiring = await Json(await Send(HttpMethod.Post, "/api/admin/invites", Kamil, new { kind = "new-household", starter = "none" }));
        var id = expiring.GetProperty("id").GetString();
        await using (var db = Db(TenantContext.System()))
        {
            (await db.InviteCodes.SingleAsync(i => i.Id == Guid.Parse(id!))).ExpiresAt = DateTimeOffset.UtcNow.AddMinutes(-1);
            await db.SaveChangesAsync();
        }
        Assert.Equal("expired", (await Json(await Send(HttpMethod.Get, "/api/admin/invites?status=all", Kamil)))
            .EnumerateArray().Single(i => i.GetProperty("id").GetString() == id).GetProperty("status").GetString());
        var extended = await Json(await Send(HttpMethod.Post, $"/api/admin/invites/{id}/extend", Kamil, new { days = 7 }));
        Assert.Equal("pending", extended.GetProperty("status").GetString());

        var history = await Json(await Send(HttpMethod.Get, "/api/admin/invites?status=all", Kamil));
        Assert.Contains(history.EnumerateArray(), i => i.GetProperty("status").GetString() == "used" && i.GetProperty("usedBy").GetString() == "Ewa");
        Assert.Contains(history.EnumerateArray(), i => i.GetProperty("status").GetString() == "revoked");
        Assert.Single((await Json(await Send(HttpMethod.Get, "/api/admin/invites", Kamil))).EnumerateArray());   // default = pending

        var kinds = await AuditKindsAsync();
        Assert.Contains("invite.created", kinds);
        Assert.Contains("invite.redeemed", kinds);
        Assert.Contains("invite.revoked", kinds);
        Assert.Contains("invite.extended", kinds);
    }

    [Fact]
    public async Task AllKeys_AreListed_AndAnAdminCanRevokeAny()
    {
        var key = (await Json(await Send(HttpMethod.Post, "/api/keys", Ola, new { name = "Codex" }))).GetProperty("key").GetString()!;
        var keys = await Json(await Send(HttpMethod.Get, "/api/admin/keys", Kamil));
        var row = Assert.Single(keys.EnumerateArray());
        Assert.Equal("Ola", row.GetProperty("personName").GetString());
        Assert.Equal("Znajomi", row.GetProperty("householdName").GetString());
        Assert.DoesNotContain(key, keys.GetRawText());

        Assert.Equal(HttpStatusCode.NoContent, (await Send(HttpMethod.Delete, $"/api/admin/keys/{row.GetProperty("id").GetString()}", Kamil)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await WithKey(key, "/api/household/invites", HttpMethod.Post)).StatusCode);
        Assert.Contains("key.revoked", await AuditKindsAsync());
    }

    // ---- helpers ----

    private MiseDbContext Db(TenantContext tenant) =>
        new(new DbContextOptionsBuilder<MiseDbContext>().UseInMemoryDatabase(_db).Options, tenant);

    private async Task<List<string>> AuditKindsAsync() =>
        (await Json(await Send(HttpMethod.Get, "/api/admin/audit?take=200", Kamil)))
            .EnumerateArray().Select(e => e.GetProperty("kind").GetString()!).ToList();

    private Task<HttpResponseMessage> Redeem(string email, string code, string name) =>
        Send(HttpMethod.Post, "/api/onboarding/redeem", email, new { code, name });

    private async Task<HttpResponseMessage> WithKey(string key, string path, HttpMethod? method = null)
    {
        var request = new HttpRequestMessage(method ?? HttpMethod.Get, path);
        request.Headers.Add("X-Api-Key", key);
        return await _client.SendAsync(request);
    }

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
