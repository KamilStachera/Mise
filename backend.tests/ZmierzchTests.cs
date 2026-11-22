using System.Net;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Mise.Api.Data;
using Mise.Api.Domain;
using Mise.Api.Features;
using Mise.Api.Services;
using Xunit;

namespace Mise.Api.Tests;

/// <summary>
/// Access control, progress merge and cross-household/unlinked leaderboard ranking for /api/zmierzch.
/// </summary>
public sealed class ZmierzchTests : IAsyncLifetime
{
    private const string MemberA = "ania@example.com";
    private const string MemberB = "kamil@example.com";
    private const string FriendUnlinked = "kasia@example.com";
    private const string BlockedUser = "blocked@example.com";

    private readonly string _db = Guid.NewGuid().ToString();
    private WebApplication _app = null!;
    private HttpClient _client = null!;

    public async Task InitializeAsync()
    {
        await using (var db = Db())
        {
            db.Households.AddRange(
                new Household { Id = 1, Name = "Dom 1" },
                new Household { Id = 2, Name = "Dom 2" });
            db.People.AddRange(
                new Person { Id = 1, HouseholdId = 1, Name = "Ania", Email = MemberA },
                new Person { Id = 2, HouseholdId = 2, Name = "Kamil", Email = MemberB },
                new Person { Id = 3, HouseholdId = 1, Name = "Zablokowany", Email = BlockedUser, BlockedAt = DateTimeOffset.UtcNow });
            await db.SaveChangesAsync();
        }

        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseTestServer();
        builder.Configuration["PUBLIC_HOUSEHOLD_ID"] = "1";
        builder.Services.AddDbContext<MiseDbContext>(o => o.UseInMemoryDatabase(_db));
        builder.Services.AddSingleton<AccessControl>();
        builder.Services.AddTenancy();
        _app = builder.Build();
        _app.Use(async (ctx, next) =>
        {
            if (ctx.Request.Headers["X-Test-Email"].ToString() is { Length: > 0 } email)
            {
                var claims = new List<Claim> { new(ClaimTypes.Email, email) };
                if (ctx.Request.Headers["X-Test-Name"].ToString() is { Length: > 0 } name)
                    claims.Add(new Claim(ClaimTypes.Name, name));
                ctx.User = new ClaimsPrincipal(new ClaimsIdentity(claims, "test"));
            }
            await next(ctx);
        });
        _app.UseMiddleware<ApiAccessMiddleware>();
        var api = _app.MapGroup("/api");
        api.MapZmierzch();
        api.MapGet("/recipes", () => Results.Ok(Array.Empty<string>()));
        await _app.StartAsync();
        _client = _app.GetTestClient();
    }

    public async Task DisposeAsync() => await _app.DisposeAsync();

    [Fact]
    public async Task AccessControl_AllowsMembersAndUnlinkedGoogleUsers_BlocksAnonymousAndBlocked()
    {
        // Anonymous cannot read or write /api/zmierzch even with PUBLIC_HOUSEHOLD_ID set.
        Assert.Equal(HttpStatusCode.Unauthorized, (await Send(HttpMethod.Get, "/api/zmierzch/me", null)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await Send(HttpMethod.Get, "/api/zmierzch/leaderboard", null)).StatusCode);

        // Blocked user stays blocked.
        Assert.Equal(HttpStatusCode.Forbidden, (await Send(HttpMethod.Get, "/api/zmierzch/me", BlockedUser)).StatusCode);

        // Unlinked Google friend can play /api/zmierzch, while remaining gated out of Pichci endpoints.
        var friendMe = await Send(HttpMethod.Get, "/api/zmierzch/me", FriendUnlinked, name: "Kasia");
        Assert.Equal(HttpStatusCode.OK, friendMe.StatusCode);
        var meJson = await Json(friendMe);
        Assert.Equal("Kasia", meJson.GetProperty("displayName").GetString());
        Assert.Equal(HttpStatusCode.Forbidden, (await Send(HttpMethod.Get, "/api/recipes", FriendUnlinked)).StatusCode);
    }

    [Fact]
    public async Task ProgressSync_MergesNewerTimestamps_AndReplaceResets()
    {
        var first = await Send(HttpMethod.Put, "/api/zmierzch/progress", MemberA, new
        {
            progress = new Dictionary<string, object>
            {
                ["zm-001"] = new { box = 2, seen = 2, wrong = 0, last = 2000L, part = "zmierzch" },
                ["kn-001"] = new { box = 3, seen = 3, wrong = 0, last = 1500L, part = "ksiezyc" },
            },
        });
        Assert.Equal(HttpStatusCode.OK, first.StatusCode);

        // Second device sends an older timestamp for zm-001 (must NOT clobber) and a newer one for kn-001 + new card.
        var second = await Send(HttpMethod.Put, "/api/zmierzch/progress", MemberA, new
        {
            progress = new Dictionary<string, object>
            {
                ["zm-001"] = new { box = 0, seen = 1, wrong = 1, last = 1000L, part = "zmierzch" },
                ["kn-001"] = new { box = 4, seen = 4, wrong = 0, last = 3000L, part = "ksiezyc" },
                ["za-001"] = new { box = 1, seen = 1, wrong = 0, last = 2500L, part = "zacmienie" },
            },
        });
        var merged = (await Json(second)).GetProperty("progress");
        Assert.Equal(2, merged.GetProperty("zm-001").GetProperty("box").GetInt32());
        Assert.Equal(4, merged.GetProperty("kn-001").GetProperty("box").GetInt32());
        Assert.Equal(1, merged.GetProperty("za-001").GetProperty("box").GetInt32());

        // Explicit replace wipes progress cleanly.
        var reset = await Send(HttpMethod.Put, "/api/zmierzch/progress", MemberA, new
        {
            mode = "replace",
            progress = new Dictionary<string, object>(),
        });
        Assert.Empty((await Json(reset)).GetProperty("progress").EnumerateObject());
    }

    [Fact]
    public async Task Leaderboard_RanksAcrossHouseholdsAndUnlinked_PerSetPartAndWholeSuite()
    {
        // Rename unlinked friend via profile endpoint.
        var rename = await Send(HttpMethod.Put, "/api/zmierzch/profile", FriendUnlinked, new { displayName = "Kasia Z." }, name: "Katarzyna");
        Assert.Equal(HttpStatusCode.OK, rename.StatusCode);

        // Fixed set: Kamil gets 20/25 in 90s; Kasia gets 20/25 in 75s (wins tie-break!); Ania gets 22/25 in 110s (#1).
        var r1 = await Json(await Send(HttpMethod.Post, "/api/zmierzch/attempts", MemberB,
            new { scope = "set:egzamin-1", correct = 20, total = 25, durationMs = 90_000, timeLimitSeconds = 20 }));
        Assert.True(r1.GetProperty("isPersonalBest").GetBoolean());
        Assert.Equal(1, r1.GetProperty("rank").GetInt32());

        // Worse second attempt for Kamil should NOT replace his personal best.
        var r1b = await Json(await Send(HttpMethod.Post, "/api/zmierzch/attempts", MemberB,
            new { scope = "set:egzamin-1", correct = 15, total = 25, durationMs = 60_000, timeLimitSeconds = 20 }));
        Assert.False(r1b.GetProperty("isPersonalBest").GetBoolean());

        await Send(HttpMethod.Post, "/api/zmierzch/attempts", FriendUnlinked,
            new { scope = "set:egzamin-1", correct = 20, total = 25, durationMs = 75_000, timeLimitSeconds = 20 });
        await Send(HttpMethod.Post, "/api/zmierzch/attempts", MemberA,
            new { scope = "set:egzamin-1", correct = 22, total = 25, durationMs = 110_000, timeLimitSeconds = 20 });

        var setLbRes = await Send(HttpMethod.Get, "/api/zmierzch/leaderboard?scope=set:egzamin-1", FriendUnlinked);
        var setLbRaw = await setLbRes.Content.ReadAsStringAsync();
        // Privacy check: raw email addresses must never appear in leaderboard output.
        Assert.DoesNotContain(MemberA, setLbRaw);
        Assert.DoesNotContain(MemberB, setLbRaw);
        Assert.DoesNotContain(FriendUnlinked, setLbRaw);

        using var setDoc = JsonDocument.Parse(setLbRaw);
        var runs = setDoc.RootElement.GetProperty("runs");
        Assert.Equal(3, runs.GetArrayLength());
        Assert.Equal("Ania", runs[0].GetProperty("name").GetString());
        Assert.Equal(22, runs[0].GetProperty("correct").GetInt32());
        Assert.Equal("Kasia Z.", runs[1].GetProperty("name").GetString());
        Assert.True(runs[1].GetProperty("isMe").GetBoolean());
        Assert.Equal(75_000, runs[1].GetProperty("durationMs").GetInt32());
        Assert.Equal("Kamil", runs[2].GetProperty("name").GetString());
        Assert.Equal(2, runs[2].GetProperty("attempts").GetInt32());
        Assert.Equal(20, runs[2].GetProperty("correct").GetInt32());

        // Whole-suite ("all") runs: 20/20 (100%) beats 10/10 (100%).
        await Send(HttpMethod.Post, "/api/zmierzch/attempts", MemberB,
            new { scope = "all", correct = 10, total = 10, durationMs = 40_000, timeLimitSeconds = 20 });
        await Send(HttpMethod.Post, "/api/zmierzch/attempts", MemberA,
            new { scope = "all", correct = 20, total = 20, durationMs = 100_000, timeLimitSeconds = 20 });

        // Custom attempts never pollute leaderboard scopes.
        var customRes = await Json(await Send(HttpMethod.Post, "/api/zmierzch/attempts", MemberA,
            new { scope = "custom", correct = 5, total = 5, durationMs = 10_000, timeLimitSeconds = 0 }));
        Assert.Equal(JsonValueKind.Null, customRes.GetProperty("rank").ValueKind);

        // Mastery synced per part: Ania masters 1 zmierzch card, Kamil masters 2 ksiezyc cards.
        await Send(HttpMethod.Put, "/api/zmierzch/progress", MemberA, new
        {
            progress = new Dictionary<string, object>
            {
                ["zm-001"] = new { box = 3, seen = 3, wrong = 0, last = 1000L, part = "zmierzch" },
            },
        });
        await Send(HttpMethod.Put, "/api/zmierzch/progress", MemberB, new
        {
            progress = new Dictionary<string, object>
            {
                ["kn-001"] = new { box = 3, seen = 3, wrong = 0, last = 1000L, part = "ksiezyc" },
                ["kn-002"] = new { box = 4, seen = 4, wrong = 0, last = 2000L, part = "ksiezyc" },
            },
        });

        var allLb = await Json(await Send(HttpMethod.Get, "/api/zmierzch/leaderboard?scope=all", MemberA));
        Assert.Equal("Ania", allLb.GetProperty("runs")[0].GetProperty("name").GetString());
        Assert.Equal("Kamil", allLb.GetProperty("mastery")[0].GetProperty("name").GetString());
        Assert.Equal(2, allLb.GetProperty("mastery")[0].GetProperty("known").GetInt32());

        // Part-scoped mastery filters to that part only.
        var zmLb = await Json(await Send(HttpMethod.Get, "/api/zmierzch/leaderboard?scope=part:zmierzch", MemberA));
        var zmMastery = zmLb.GetProperty("mastery");
        Assert.Equal(1, zmMastery.GetArrayLength());
        Assert.Equal("Ania", zmMastery[0].GetProperty("name").GetString());
        Assert.Equal(1, zmMastery[0].GetProperty("known").GetInt32());
    }

    private MiseDbContext Db() => new(
        new DbContextOptionsBuilder<MiseDbContext>().UseInMemoryDatabase(_db).Options,
        TenantContext.System());

    private async Task<HttpResponseMessage> Send(HttpMethod method, string path, string? email, object? body = null, string? name = null)
    {
        using var req = new HttpRequestMessage(method, path);
        if (email is not null) req.Headers.Add("X-Test-Email", email);
        if (name is not null) req.Headers.Add("X-Test-Name", name);
        if (body is not null) req.Content = JsonContent.Create(body);
        return await _client.SendAsync(req);
    }

    private static async Task<JsonElement> Json(HttpResponseMessage res)
    {
        var raw = await res.Content.ReadAsStringAsync();
        Assert.True(res.IsSuccessStatusCode, $"{res.StatusCode}: {raw}");
        return JsonDocument.Parse(raw).RootElement.Clone();
    }
}
