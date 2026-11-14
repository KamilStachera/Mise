using System.Net;
using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Mise.Api.Data;
using Mise.Api.Domain;
using Mise.Api.Services;
using Xunit;

namespace Mise.Api.Tests;

/// <summary>Households are separate tenants: data isolation, the save guard, and who a request acts as.</summary>
public class TenancyTests
{
    private const string Ania = "ania@example.com", Kamil = "kamil@example.com", Friend = "friend@example.com";

    // ---- data isolation ----

    [Fact]
    public async Task EachHousehold_SeesOnlyItsOwnRows_IncludingChildrenAndLookupsById()
    {
        var name = Guid.NewGuid().ToString();
        var (recipeA, pantryA) = await SeedTwoHouseholdsAsync(name);

        await using var b = Db(name, TenantContext.For(2));
        Assert.Equal(["Pierogi"], await b.Recipes.Select(r => r.Title).ToListAsync());
        Assert.Null(await b.Recipes.FindAsync(recipeA));
        Assert.Null(await b.PantryItems.FirstOrDefaultAsync(p => p.Id == pantryA));
        Assert.Equal(["mąka"], await b.RecipeIngredients.Select(i => i.Name).ToListAsync());
        Assert.Equal(["Mleko"], await b.ShoppingItems.Select(s => s.Name).ToListAsync());
        Assert.Equal([3], await b.People.Select(p => p.Id).ToListAsync());
        Assert.Single(await b.PlanEntries.ToListAsync());

        await using var a = Db(name, TenantContext.For(1));
        Assert.Equal(["Shakshuka"], await a.Recipes.Select(r => r.Title).ToListAsync());
        Assert.Equal([1, 2], await a.People.OrderBy(p => p.Id).Select(p => p.Id).ToListAsync());

        await using var system = Db(name, TenantContext.System());
        Assert.Equal(2, await system.Recipes.CountAsync());

        await using var nobody = Db(name, new TenantContext());   // fail closed
        Assert.Empty(await nobody.Recipes.ToListAsync());
        Assert.Empty(await nobody.RecipeIngredients.ToListAsync());
    }

    [Fact]
    public async Task NewRows_AreStampedWithTheTenant_AndCrossHouseholdWritesThrow()
    {
        var name = Guid.NewGuid().ToString();
        var (recipeA, _) = await SeedTwoHouseholdsAsync(name);

        await using var b = Db(name, TenantContext.For(2));
        var added = new Recipe { Title = "Bigos" };
        b.Recipes.Add(added);
        await b.SaveChangesAsync();
        Assert.Equal(2, added.HouseholdId);

        // An entity of household 1 smuggled into household 2's context can't be saved.
        await using var system = Db(name, TenantContext.System());
        var foreign = await system.Recipes.AsNoTracking().FirstAsync(r => r.Id == recipeA);
        foreign.Title = "Przejęte";
        b.Recipes.Update(foreign);
        await Assert.ThrowsAsync<TenantViolationException>(() => b.SaveChangesAsync());
        b.ChangeTracker.Clear();

        var moved = await b.Recipes.FirstAsync(r => r.Id == added.Id);
        moved.HouseholdId = 1;
        await Assert.ThrowsAsync<TenantViolationException>(() => b.SaveChangesAsync());
        b.ChangeTracker.Clear();

        b.PlanEntries.Add(new PlanEntry { Title = "bez osoby" });
        await Assert.ThrowsAsync<TenantViolationException>(() => b.SaveChangesAsync());
        b.ChangeTracker.Clear();

        // A system scope must say which household a new row belongs to.
        system.Recipes.Add(new Recipe { Title = "Niczyj" });
        await Assert.ThrowsAsync<TenantViolationException>(() => system.SaveChangesAsync());
    }

    [Fact]
    public async Task CustomExercises_BelongToTheirHousehold_TheCatalogIsShared()
    {
        var name = Guid.NewGuid().ToString();
        await using (var system = Db(name, TenantContext.System()))
        {
            system.Exercises.Add(new Exercise { SourceId = "Air_Bike", NameEn = "Air Bike" });
            await system.SaveChangesAsync();
        }
        await using (var b = Db(name, TenantContext.For(2)))
        {
            b.Exercises.Add(new Exercise { NameEn = "Nasze ćwiczenie" });
            await b.SaveChangesAsync();
            Assert.Equal(2, await b.Exercises.CountAsync());
        }
        await using var a = Db(name, TenantContext.For(1));
        Assert.Equal(["Air Bike"], await a.Exercises.Select(e => e.NameEn).ToListAsync());
    }

    // ---- who a request acts as ----

    [Fact]
    public async Task Resolve_GoogleMembers_PickWithinTheirHouseholdOnly()
    {
        var (db, access) = await ResolverSetupAsync();

        var kamil = await ResolveAsync(db, access, email: "KAMIL@example.com");
        Assert.Equal(CallerKind.Member, kamil.Kind);
        Assert.Equal(2, kamil.Acting!.Id);
        Assert.Equal(1, kamil.HouseholdId);
        Assert.True(kamil.IsAdmin);
        Assert.Equal([1, 2], kamil.People.Select(p => p.Id));
        Assert.Equal(1, db.Tenant.HouseholdId);

        Assert.Equal(1, (await ResolveAsync(db, access, email: Kamil, header: "1")).Acting!.Id);   // partner's diary
        Assert.Equal(2, (await ResolveAsync(db, access, email: Kamil, header: "3")).Acting!.Id);   // other household: ignored
        Assert.Equal(2, (await ResolveAsync(db, access, email: Kamil, header: "99")).Acting!.Id);  // unknown: ignored

        var friend = await ResolveAsync(db, access, email: Friend, header: "1");
        Assert.Equal(3, friend.Acting!.Id);
        Assert.Equal(2, friend.HouseholdId);
        Assert.False(friend.IsAdmin);
        Assert.Equal([3], friend.People.Select(p => p.Id));
        Assert.Equal(2, db.Tenant.HouseholdId);
    }

    [Fact]
    public async Task Resolve_StrangersAndAnonymous_AreReadOnlyOnThePublicHousehold()
    {
        var (db, access) = await ResolverSetupAsync();

        var stranger = await ResolveAsync(db, access, email: "stranger@example.com");
        Assert.Equal(CallerKind.Unlinked, stranger.Kind);
        Assert.False(stranger.IsPrivileged);
        Assert.Equal(1, stranger.HouseholdId);

        var anonymous = await ResolveAsync(db, access, header: "3");
        Assert.Equal(CallerKind.Anonymous, anonymous.Kind);
        Assert.False(anonymous.IsPrivileged);
        Assert.Equal(1, anonymous.Acting!.Id);   // the public household's first person, header ignored
        Assert.Empty(anonymous.People);

        var (privateDb, privateAccess) = await ResolverSetupAsync(publicHousehold: null);
        var nobody = await ResolveAsync(privateDb, privateAccess);
        Assert.Null(nobody.HouseholdId);   // and the tenant was left untouched (checked in ResolveAsync)
    }

    [Fact]
    public async Task Resolve_Keys_SystemKeyNeedsAPerson_PersonalKeyIsItsPerson()
    {
        var (db, access) = await ResolverSetupAsync();
        var key = AccessControl.NewPersonalKey();
        var revoked = AccessControl.NewPersonalKey();
        db.Tenant.UseSystem();
        db.ApiKeys.Add(new ApiKey { HouseholdId = 2, PersonId = 3, Name = "Codex", KeyHash = AccessControl.HashKey(key), Prefix = key[..8] });
        db.ApiKeys.Add(new ApiKey { HouseholdId = 1, PersonId = 1, Name = "stary", KeyHash = AccessControl.HashKey(revoked), Prefix = revoked[..8], RevokedAt = DateTimeOffset.UtcNow });
        await db.SaveChangesAsync();

        var sous = await ResolveAsync(db, access, apiKey: "secret", header: "3");
        Assert.Equal(CallerKind.SystemKey, sous.Kind);
        Assert.Equal(2, sous.HouseholdId);
        Assert.True(sous.IsPrivileged);
        Assert.False((await ResolveAsync(db, access, apiKey: "secret")).IsPrivileged);   // never defaults to anyone

        var agent = await ResolveAsync(db, access, apiKey: key, header: "1");
        Assert.Equal(CallerKind.PersonalKey, agent.Kind);
        Assert.Equal(3, agent.Acting!.Id);   // other household's person: ignored
        Assert.Equal(2, agent.HouseholdId);

        Assert.False((await ResolveAsync(db, access, apiKey: revoked)).IsPrivileged);
        Assert.False((await ResolveAsync(db, access, apiKey: "pk_nope")).IsPrivileged);
    }

    [Fact]
    public async Task LegacyConfig_LinksExistingPeople_AndAddsWhitelistedStrangers_Idempotently()
    {
        await using var db = Db(Guid.NewGuid().ToString(), TenantContext.System());
        db.Households.Add(new Household { Id = 1, Name = "Dom" });
        db.People.Add(new Person { Id = 1, HouseholdId = 1, Name = "Ja" });
        await db.SaveChangesAsync();
        var config = Config(new()
        {
            ["Diary:People"] = $"Ania:{Ania}, Kamil:KAMIL@example.com",
            ["Auth:AllowedEmails"] = $"{Ania},{Kamil},third@example.com",
        });

        await People.ImportLegacyConfigAsync(db, config, NullLogger.Instance);
        await People.ImportLegacyConfigAsync(db, config, NullLogger.Instance);

        var people = await db.People.OrderBy(p => p.Id).ToListAsync();
        Assert.Equal(3, people.Count);
        Assert.Equal(("Ania", Ania), (people[0].Name, people[0].Email));
        Assert.Contains(people, p => p is { Name: "Kamil", Email: Kamil, HouseholdId: 1 });
        Assert.Contains(people, p => p is { Name: "third", Email: "third@example.com", HouseholdId: 1 });
    }

    // ---- the middleware, end to end ----

    [Fact]
    public async Task Middleware_ScopesRequestsToTheCallersHousehold()
    {
        var name = Guid.NewGuid().ToString();
        await SeedTwoHouseholdsAsync(name);
        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseTestServer();
        builder.Configuration["Auth:PublicHouseholdId"] = "1";
        builder.Services.AddDbContext<MiseDbContext>(o => o.UseInMemoryDatabase(name));
        builder.Services.AddSingleton<AccessControl>();
        builder.Services.AddTenancy();
        await using var app = builder.Build();
        // Stand-in for the Google cookie: the test names the signed-in email in a header.
        app.Use(async (ctx, next) =>
        {
            if (ctx.Request.Headers["X-Test-Email"].ToString() is { Length: > 0 } email)
                ctx.User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.Email, email)], "test"));
            await next(ctx);
        });
        app.UseMiddleware<ApiAccessMiddleware>();
        app.MapGet("/api/recipes", (MiseDbContext db) => db.Recipes.Select(r => r.Title).ToListAsync());
        app.MapPost("/api/recipes", async (MiseDbContext db) =>
        {
            db.Recipes.Add(new Recipe { Title = "Nowy" });
            await db.SaveChangesAsync();
            return Results.Ok();
        });
        await app.StartAsync();
        using var client = app.GetTestClient();

        async Task<HttpResponseMessage> Send(HttpMethod method, string? email)
        {
            var request = new HttpRequestMessage(method, "/api/recipes");
            if (email is not null) request.Headers.Add("X-Test-Email", email);
            return await client.SendAsync(request);
        }

        Assert.Equal("[\"Pierogi\"]", await (await Send(HttpMethod.Get, Friend)).Content.ReadAsStringAsync());
        Assert.Equal("[\"Shakshuka\"]", await (await Send(HttpMethod.Get, Kamil)).Content.ReadAsStringAsync());
        Assert.Equal("[\"Shakshuka\"]", await (await Send(HttpMethod.Get, null)).Content.ReadAsStringAsync());   // public

        Assert.Equal(HttpStatusCode.OK, (await Send(HttpMethod.Post, Friend)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await Send(HttpMethod.Post, null)).StatusCode);
        var stranger = await Send(HttpMethod.Post, "stranger@example.com");
        Assert.Equal(HttpStatusCode.Forbidden, stranger.StatusCode);
        Assert.True(JsonDocument.Parse(await stranger.Content.ReadAsStringAsync()).RootElement.GetProperty("needsOnboarding").GetBoolean());

        await using var system = Db(name, TenantContext.System());
        Assert.Equal(2, (await system.Recipes.SingleAsync(r => r.Title == "Nowy")).HouseholdId);
    }

    [Fact]
    public void PersonLookups_TranslateToPostgresSql()
    {
        // EF InMemory evaluates anything; Npgsql must translate. ToQueryString needs no server.
        using var db = new MiseDbContext(new DbContextOptionsBuilder<MiseDbContext>()
            .UseNpgsql("Host=localhost;Database=never-connected").Options, TenantContext.System());
        const string email = "a@example.com";
        foreach (var query in new[]
        {
            People.Query(db, p => p.Id == 1),
            People.Query(db, p => p.Email == email),
            People.Query(db, p => p.HouseholdId == 2),
            People.Query(db, _ => true),
        })
            Assert.Contains("FROM \"People\"", query.ToQueryString());
    }

    // ---- helpers ----

    private static MiseDbContext Db(string name, TenantContext tenant) =>
        new(new DbContextOptionsBuilder<MiseDbContext>().UseInMemoryDatabase(name).Options, tenant);

    private static IConfiguration Config(Dictionary<string, string?> values) =>
        new ConfigurationBuilder().AddInMemoryCollection(values).Build();

    /// <summary>Household 1: Ania (1) + Kamil (2), Shakshuka. Household 2: the friend (3), Pierogi.</summary>
    private static async Task<(Guid RecipeA, Guid PantryA)> SeedTwoHouseholdsAsync(string name)
    {
        await using var db = Db(name, TenantContext.System());
        db.Households.AddRange(new Household { Id = 1, Name = "Dom" }, new Household { Id = 2, Name = "Znajomi" });
        db.People.AddRange(
            new Person { Id = 1, HouseholdId = 1, Name = "Ania", Email = Ania },
            new Person { Id = 2, HouseholdId = 1, Name = "Kamil", Email = Kamil },
            new Person { Id = 3, HouseholdId = 2, Name = "Friend", Email = Friend });
        var pantryA = new PantryItem { HouseholdId = 1, Name = "Jajka" };
        var recipeA = new Recipe { HouseholdId = 1, Title = "Shakshuka", Ingredients = [new() { Name = "jajka" }] };
        db.PantryItems.AddRange(pantryA, new PantryItem { HouseholdId = 2, Name = "Mąka" });
        db.Recipes.AddRange(recipeA, new Recipe { HouseholdId = 2, Title = "Pierogi", Ingredients = [new() { Name = "mąka" }] });
        db.ShoppingItems.AddRange(new ShoppingItem { HouseholdId = 1, Name = "Chleb" }, new ShoppingItem { HouseholdId = 2, Name = "Mleko" });
        db.PlanEntries.AddRange(
            new PlanEntry { HouseholdId = 1, PersonId = 1, Title = "obiad" },
            new PlanEntry { HouseholdId = 2, PersonId = 3, Title = "obiad" });
        await db.SaveChangesAsync();
        return (recipeA.Id, pantryA.Id);
    }

    private static async Task<(MiseDbContext Db, AccessControl Access)> ResolverSetupAsync(int? publicHousehold = 1)
    {
        var name = Guid.NewGuid().ToString();
        await SeedTwoHouseholdsAsync(name);
        var access = new AccessControl(Config(new()
        {
            ["MISE_API_KEY"] = "secret",
            ["Auth:AdminEmails"] = Kamil,
            ["Auth:PublicHouseholdId"] = publicHousehold?.ToString(),
        }));
        return (Db(name, new TenantContext()), access);
    }

    private static async Task<Caller> ResolveAsync(MiseDbContext db, AccessControl access,
        string? email = null, string? header = null, string? apiKey = null)
    {
        var ctx = new DefaultHttpContext();
        if (header is not null) ctx.Request.Headers[People.Header] = header;
        if (apiKey is not null) ctx.Request.Headers[AccessControl.ApiKeyHeader] = apiKey;
        if (email is not null)
            ctx.User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.Email, email)], "test"));
        var caller = new Caller();
        db.Tenant.UseHousehold(0);   // reset between calls on the same context
        db.ChangeTracker.Clear();
        await People.ResolveAsync(ctx, db, access, caller);
        if (caller.HouseholdId is null) Assert.Equal(0, db.Tenant.HouseholdId);
        return caller;
    }
}
