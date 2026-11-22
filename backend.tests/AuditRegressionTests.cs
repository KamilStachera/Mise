using System.IO.Compression;
using System.Net;
using System.Net.Http.Json;
using System.Runtime.CompilerServices;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Mise.Api.Data;
using Mise.Api.Domain;
using Mise.Api.Features;
using Mise.Api.Services;
using Mise.Api.Services.AiChat;
using Mise.Api.Services.Import;
using Mise.Api.Services.Strava;
using Mise.Api.Services.Training;
using SkiaSharp;
using Xunit;

namespace Mise.Api.Tests;

/// <summary>
/// Regression tests for the Wave 1 &amp; Wave 2 security, tenancy, domain, and resilience audit fixes.
/// </summary>
public class AuditRegressionTests
{
    private const string AdminEmail = "admin@example.com";
    private const string MemberEmail = "member@example.com";
    private const string BlockedPartnerEmail = "blocked@example.com";
    private const string StrangerEmail = "stranger@example.com";

    // ---- 1. Auth, Tenancy & Access Control ----

    [Fact]
    public async Task SharedExercise_PatchAndEnrich_ForbiddenForNonAdmin_AllowedForAdmin()
    {
        await using var host = await BuildTestAppAsync();
        var sharedId = host.SharedExerciseId;

        var memberPatch = await host.SendAsync(HttpMethod.Patch, $"/api/exercises/{sharedId}",
            email: MemberEmail, body: new { namePl = "Zhakowane" });
        Assert.Equal(HttpStatusCode.Forbidden, memberPatch.StatusCode);

        var memberEnrich = await host.SendAsync(HttpMethod.Post, "/api/exercises/enrich",
            email: MemberEmail, body: new { items = new[] { new { id = sharedId, namePl = "Zhakowane" } } });
        Assert.Equal(HttpStatusCode.OK, memberEnrich.StatusCode);
        using (var doc = JsonDocument.Parse(await memberEnrich.Content.ReadAsStringAsync()))
        {
            Assert.Equal(0, doc.RootElement.GetProperty("updated").GetInt32());
            Assert.Single(doc.RootElement.GetProperty("errors").EnumerateArray());
        }
        using (var scope = host.App.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<MiseDbContext>();
            db.Tenant.UseSystem();
            var unchanged = await db.Exercises.SingleAsync(e => e.Id == sharedId);
            Assert.Null(unchanged.NamePl);
        }

        var adminPatch = await host.SendAsync(HttpMethod.Patch, $"/api/exercises/{sharedId}",
            email: AdminEmail, body: new { namePl = "Przysiad ze sztangą" });
        Assert.Equal(HttpStatusCode.OK, adminPatch.StatusCode);
    }

    [Fact]
    public async Task SousToken_IsPinnedToPerson_IgnoresXPerson_AndBlockedOnForbiddenEndpoints()
    {
        await using var host = await BuildTestAppAsync();
        var access = host.App.Services.GetRequiredService<AccessControl>();
        var token = access.MintSousToken(householdId: 2, personId: 3);
        Assert.StartsWith(AccessControl.SousTokenPrefix, token);

        // SousToken cannot manage API keys, invites, people, HC connection, or admin routes.
        foreach (var path in new[]
        {
            "/api/keys",
            "/api/household/invites",
            "/api/household/people/3",
            "/api/activity/connection",
            "/api/admin/overview",
        })
        {
            var res = await host.SendAsync(HttpMethod.Get, path, apiKey: token);
            Assert.Equal(HttpStatusCode.Forbidden, res.StatusCode);
        }

        // SousToken can still read its own household's pantry & ignore X-Person pointing elsewhere.
        var pantry = await host.SendAsync(HttpMethod.Get, "/api/pantry", apiKey: token, xPerson: "1");
        Assert.Equal(HttpStatusCode.OK, pantry.StatusCode);
    }

    [Fact]
    public async Task AgentRecipe_WithIngredientWithoutAmount_IsRejected_ButTheEditorMaySaveIt()
    {
        await using var host = await BuildTestAppAsync();
        var key = AccessControl.NewPersonalKey();
        using (var scope = host.App.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<MiseDbContext>();
            db.Tenant.UseSystem();
            db.ApiKeys.Add(new ApiKey { HouseholdId = 1, PersonId = 1, Name = "Agent", KeyHash = AccessControl.HashKey(key), Prefix = key[..8] });
            await db.SaveChangesAsync();
        }
        object Recipe(string title) => new
        {
            title,
            source = "ai",
            time = 20,
            servings = 2,
            ingredients = new object[]
            {
                new { name = "Makaron", amountValue = 200, amountUnit = "g" },   // structured only → fine
                new { name = "Sól", quantity = "do smaku" },                       // no number → rejected
            },
            steps = new[] { "Ugotuj makaron 10 minut." },
        };

        var agent = await host.SendAsync(HttpMethod.Post, "/api/recipes", apiKey: key, body: Recipe("Od agenta"));
        Assert.Equal(HttpStatusCode.BadRequest, agent.StatusCode);
        using (var doc = JsonDocument.Parse(await agent.Content.ReadAsStringAsync()))
            Assert.Equal(["Sól"], doc.RootElement.GetProperty("ingredients").EnumerateArray().Select(e => e.GetString()));

        var person = await host.SendAsync(HttpMethod.Post, "/api/recipes", email: AdminEmail, body: Recipe("Z edytora"));
        Assert.Equal(HttpStatusCode.Created, person.StatusCode);
        using (var scope = host.App.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<MiseDbContext>();
            db.Tenant.UseHousehold(1);
            var saved = await db.Recipes.Include(r => r.Ingredients).SingleAsync(r => r.Title == "Z edytora");
            Assert.Equal("200 g", saved.Ingredients.Single(i => i.Name == "Makaron").Quantity);
        }
    }

    [Fact]
    public async Task NutritionEstimate_ReturnsSousNumbersWithoutSaving_AndNeedsSous()
    {
        var reply = """{"kcal": 455, "protein": 28, "fat": 12.5, "carbs": 58, "note": "Mniej sera obniżyło tłuszcz."}""";
        await using var host = await BuildTestAppAsync(b =>
        {
            b.Configuration["AI_PROVIDER"] = "codex";
            b.Services.AddSingleton<ISousJobs>(new StubSousJobs(reply));
        });
        Guid recipeId;
        using (var scope = host.App.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<MiseDbContext>();
            db.Tenant.UseHousehold(1);
            var recipe = new Recipe
            {
                Title = "Makaron z serem", Servings = 2, KcalPerServing = 600, ProteinGrams = 30, FatGrams = 25, CarbGrams = 58,
                Ingredients = [new RecipeIngredient { Name = "Makaron", Quantity = "200 g", AmountValue = 200, AmountUnit = PantryUnit.G }],
            };
            db.Recipes.Add(recipe);
            await db.SaveChangesAsync();
            recipeId = recipe.Id;
        }

        // Sous off for the household → 409, nothing asked.
        var off = await host.SendAsync(HttpMethod.Post, $"/api/recipes/{recipeId}/nutrition/estimate", email: AdminEmail);
        Assert.Equal(HttpStatusCode.Conflict, off.StatusCode);

        using (var scope = host.App.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<MiseDbContext>();
            db.Tenant.UseSystem();
            (await db.Households.SingleAsync(h => h.Id == 1)).SousEnabled = true;
            await db.SaveChangesAsync();
        }

        var res = await host.SendAsync(HttpMethod.Post, $"/api/recipes/{recipeId}/nutrition/estimate", email: AdminEmail);
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        using (var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync()))
        {
            Assert.Equal(455, doc.RootElement.GetProperty("estimate").GetProperty("kcal").GetInt32());
            Assert.Equal(600, doc.RootElement.GetProperty("current").GetProperty("kcal").GetInt32());
            Assert.Equal("Mniej sera obniżyło tłuszcz.", doc.RootElement.GetProperty("note").GetString());
        }
        using (var scope = host.App.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<MiseDbContext>();
            db.Tenant.UseHousehold(1);
            Assert.Equal(600, (await db.Recipes.SingleAsync(r => r.Id == recipeId)).KcalPerServing); // only an estimate
        }
    }

    [Fact]
    public async Task PortionSettings_FullServingsDefault_FixedIngredients_AndResplit()
    {
        await using var host = await BuildTestAppAsync();
        object Recipe(string title) => new
        {
            title, source = "ai", time = 30, servings = 4, kcal = 600, protein = 30, fat = 20, carbs = 70,
            ingredients = new[] { new { name = "Makaron", quantity = "400 g", amountValue = 400, amountUnit = "g" } },
            steps = new[] { "Ugotuj makaron 10 minut." },
        };
        async Task<JsonElement> Get(string path)
        {
            var res = await host.SendAsync(HttpMethod.Get, path, email: AdminEmail);
            Assert.Equal(HttpStatusCode.OK, res.StatusCode);
            return JsonDocument.Parse(await res.Content.ReadAsStringAsync()).RootElement;
        }
        async Task<Guid> Create(string title)
        {
            var res = await host.SendAsync(HttpMethod.Post, "/api/recipes", email: AdminEmail, body: Recipe(title));
            Assert.Equal(HttpStatusCode.Created, res.StatusCode);
            return JsonDocument.Parse(await res.Content.ReadAsStringAsync()).RootElement.GetProperty("id").GetGuid();
        }

        // Default household: a new recipe opens at 1 portion, ingredients scaled to it.
        var a = await Create("Domyślny");
        Assert.Equal(1, (await Get($"/api/recipes/{a}")).GetProperty("selectedServings").GetInt32());

        // "New recipes at full portions" + "Nie łącz porcji ze składnikami".
        var set = await host.SendAsync(HttpMethod.Put, "/api/household/portions", email: AdminEmail,
            body: new { newRecipesFullServings = true, keepIngredientsFixed = true });
        Assert.Equal(HttpStatusCode.OK, set.StatusCode);
        var me = await Get("/api/auth/me");
        Assert.True(me.GetProperty("household").GetProperty("keepIngredientsFixed").GetBoolean());

        var b = await Create("Pełne porcje");
        var detail = await Get($"/api/recipes/{b}");
        Assert.Equal(4, detail.GetProperty("selectedServings").GetInt32());
        // Fixed mode shows the whole dish even for the older recipe saved at 1 portion.
        var older = await Get($"/api/recipes/{a}");
        Assert.Equal(4, older.GetProperty("selectedServings").GetInt32());
        Assert.Equal("400 g", older.GetProperty("ingredients")[0].GetProperty("quantity").GetString());
        // The scaling picker is off in fixed mode; the agent is told where to go instead.
        var servings = await host.SendAsync(HttpMethod.Put, $"/api/recipes/{a}/servings", email: AdminEmail, body: new { servings = 2 });
        Assert.Equal(HttpStatusCode.Conflict, servings.StatusCode);

        // The small eater splits the same pot into 6: 4 × 600 kcal → 6 × 400 kcal, ingredients untouched.
        var split = await host.SendAsync(HttpMethod.Put, $"/api/recipes/{a}/portion-count", email: AdminEmail, body: new { portions = 6 });
        Assert.Equal(HttpStatusCode.OK, split.StatusCode);
        var after = await Get($"/api/recipes/{a}");
        Assert.Equal(6, after.GetProperty("servings").GetInt32());
        Assert.Equal(400, after.GetProperty("kcal").GetInt32());
        Assert.Equal("400 g", after.GetProperty("ingredients")[0].GetProperty("quantity").GetString());

        var bad = await host.SendAsync(HttpMethod.Put, $"/api/recipes/{a}/portion-count", email: AdminEmail, body: new { portions = 0 });
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
    }

    private sealed class StubSousJobs(string reply) : ISousJobs
    {
        public Task<string> RunAsync(string prompt, System.Text.Json.Nodes.JsonObject outputSchema, CancellationToken ct) =>
            Task.FromResult(reply);
    }

    [Fact]
    public async Task PersonalKey_XPersonPicksActiveHouseholdMember_ElseFallsBackToOwner()
    {
        await using var host = await BuildTestAppAsync();
        var key = AccessControl.NewPersonalKey();
        using (var scope = host.App.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<MiseDbContext>();
            db.Tenant.UseSystem();
            db.ApiKeys.Add(new ApiKey
            {
                HouseholdId = 1,
                PersonId = 1,
                Name = "Test",
                KeyHash = AccessControl.HashKey(key),
                Prefix = key[..8],
            });
            await db.SaveChangesAsync();
        }

        // X-Person 4 = active partner in household 1 → their diary (one key serves a couple, as documented).
        // X-Person 2 = blocked partner, X-Person 3 = another household → silently the key's owner.
        foreach (var (pick, title) in new[] { ("4", "Partner"), ("2", "Zablokowana"), ("3", "Obcy dom") })
        {
            var log = await host.SendAsync(HttpMethod.Post, "/api/plan/entries", apiKey: key, xPerson: pick, body: new
            {
                date = "2026-11-20",
                slot = "breakfast",
                title,
                kcal = 350,
            });
            Assert.True(log.IsSuccessStatusCode, $"Expected 2xx, got {(int)log.StatusCode}: {await log.Content.ReadAsStringAsync()}");
        }

        using (var scope = host.App.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<MiseDbContext>();
            db.Tenant.UseHousehold(1);
            var owners = await db.PlanEntries.ToDictionaryAsync(e => e.Title, e => e.PersonId);
            Assert.Equal(4, owners["Partner"]);
            Assert.Equal(1, owners["Zablokowana"]);
            Assert.Equal(1, owners["Obcy dom"]);
        }
    }

    [Fact]
    public async Task SystemKey_RejectedFromPublicRemoteIp()
    {
        await using var host = await BuildTestAppAsync();
        using var scope = host.App.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<MiseDbContext>();
        var access = scope.ServiceProvider.GetRequiredService<AccessControl>();

        var ctx = new DefaultHttpContext();
        ctx.Request.Headers[AccessControl.ApiKeyHeader] = "test-system-secret";
        ctx.Request.Headers[People.Header] = "1";
        ctx.Connection.RemoteIpAddress = IPAddress.Parse("8.8.8.8");

        var caller = new Caller();
        await People.ResolveAsync(ctx, db, access, caller);
        Assert.Equal(CallerKind.Anonymous, caller.Kind);
        Assert.False(caller.IsPrivileged);
    }

    [Fact]
    public async Task BlockedPartner_InXPersonHeader_FallsBackToSelfInsteadOfLockingOutCaller()
    {
        await using var host = await BuildTestAppAsync();
        var res = await host.SendAsync(HttpMethod.Get, "/api/pantry", email: AdminEmail, xPerson: "2");
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
    }

    [Fact]
    public async Task PublicHouseholdScope_HidesPrivateEndpoints_AndKeepsRecipesPublic()
    {
        await using var host = await BuildTestAppAsync();

        Assert.Equal(HttpStatusCode.OK, (await host.SendAsync(HttpMethod.Get, "/api/recipes")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await host.SendAsync(HttpMethod.Get, "/api/exercises")).StatusCode);

        foreach (var path in new[]
        {
            "/api/pantry",
            "/api/shopping",
            "/api/supplies",
            "/api/preferences",
            "/api/profile/questionnaire",
            "/api/context/cookbook",
            "/api/cooklog",
            "/api/plan/pending-cook",
            "/api/plan/shopping-preview",
        })
        {
            var res = await host.SendAsync(HttpMethod.Get, path);
            Assert.Equal(HttpStatusCode.Unauthorized, res.StatusCode);
        }
    }

    [Fact]
    public async Task UnlinkedGoogleAccount_Gets403NeedsOnboarding_EvenOnPublicRoutes()
    {
        await using var host = await BuildTestAppAsync();
        var res = await host.SendAsync(HttpMethod.Get, "/api/recipes", email: StrangerEmail);
        Assert.Equal(HttpStatusCode.Forbidden, res.StatusCode);
        var body = await res.Content.ReadAsStringAsync();
        Assert.Contains("needsOnboarding", body);
    }

    // ---- 2. SSRF & Import Hardening ----

    [Fact]
    public void SafeWebFetcher_ValidatesPublicIpv6_AndRejectsNonStandardPortsAndPrivateHosts()
    {
        Assert.Equal(new Uri("https://[2606:4700:4700::1111]/recipe"),
            SafeWebFetcher.ValidateUrl("https://[2606:4700:4700::1111]/recipe"));
        Assert.Throws<FetchRefusedException>(() => SafeWebFetcher.ValidateUrl("https://example.com:8443/recipe"));
        Assert.Throws<FetchRefusedException>(() => SafeWebFetcher.ValidateUrl("http://127.0.0.1/admin"));
        Assert.Throws<FetchRefusedException>(() => SafeWebFetcher.ValidateUrl("http://[::1]/admin"));
        Assert.Throws<FetchRefusedException>(() => SafeWebFetcher.ValidateUrl("http://169.254.169.254/latest/meta-data"));
    }

    [Fact]
    public void RecipeMicrodata_AndPageParser_HandleDeepNestingAndOverflowDurationSafely()
    {
        // Deeply nested HTML/microdata must not stack overflow.
        var deepHtml = new string(' ', 0)
            + string.Concat(Enumerable.Repeat("<div itemscope itemtype=\"https://schema.org/Recipe\">", 600))
            + "<span itemprop=\"name\">Deep</span>"
            + string.Concat(Enumerable.Repeat("</div>", 600));
        _ = RecipeMicrodata.Parse(deepHtml, s => s);

        // Huge ISO-8601 duration must not throw OverflowException.
        var hugeDurationHtml = """
            <html><head><script type="application/ld+json">
            {"@context":"https://schema.org","@type":"Recipe","name":"Test","prepTime":"PT999999999999999999999M","recipeIngredient":["100 g mąki"],"recipeInstructions":["Wymieszaj."]}
            </script></head><body></body></html>
            """;
        var extracted = RecipePageParser.Parse(hugeDurationHtml, new Uri("https://example.com/r"));
        var recipe = Assert.Single(extracted.Recipes);
        Assert.Equal("Test", recipe.Name);
        Assert.Null(recipe.PrepMinutes);
    }

    // ---- 3. Strava & Health Connect ----

    [Fact]
    public async Task Strava_ForgedAthleteActivityIgnored_AndDecryptFailurePreservesConnection()
    {
        await using var db = NewInMemoryDb();
        var handler = new StubHttpHandler();
        var options = new StravaOptions("123", "secret", null);
        var dp1 = new EphemeralDataProtectionProvider();
        var strava1 = new StravaService(db, new StravaClient(new HttpClient(handler)), options, dp1, person: new PersonScope(1));

        handler.Map["POST /oauth/token"] = (HttpStatusCode.OK, JsonSerializer.Serialize(new
        {
            token_type = "Bearer",
            access_token = "acc-1",
            refresh_token = "ref-1",
            expires_at = DateTimeOffset.UtcNow.AddHours(6).ToUnixTimeSeconds(),
            athlete = new { id = 777, firstname = "Ania", lastname = "K" },
        }));
        handler.Map["GET /api/v3/athlete/activities"] = (HttpStatusCode.OK, "[]");
        Assert.Equal(StravaConnectOutcome.Connected, await strava1.ConnectAsync(1, "code", "read,activity:read_all"));

        // Forged activity belonging to athlete 999 instead of 777 must be rejected!
        handler.Map["GET /api/v3/activities/99"] = (HttpStatusCode.OK, JsonSerializer.Serialize(new
        {
            id = 99,
            name = "Other Athlete",
            sport_type = "Run",
            type = "Run",
            start_date = DateTimeOffset.UtcNow.AddHours(-2).ToString("yyyy-MM-ddTHH:mm:ssZ"),
            elapsed_time = 1800,
            moving_time = 1800,
            calories = 300,
            athlete = new { id = 999 },
        }));
        var outcome = await strava1.HandleEventAsync(
            new StravaEvent("activity", 99, "create", OwnerId: 777, SubscriptionId: 1, EventTime: DateTimeOffset.UtcNow.ToUnixTimeSeconds(), Updates: null));
        Assert.Equal(StravaEventOutcome.Ignored, outcome);
        Assert.Empty(await db.Workouts.ToListAsync());

        // Different DataProtection key ring (e.g. volume hiccup) skips cleanly and KEEPS the Strava connection row!
        var dp2 = new EphemeralDataProtectionProvider();
        var strava2 = new StravaService(db, new StravaClient(new HttpClient(handler)), options, dp2, person: new PersonScope(1));
        var conn = await db.StravaConnections.SingleAsync();
        Assert.Equal(0, await strava2.SyncAsync(conn, 7, refreshKnown: false));
        Assert.Equal(StravaEventOutcome.Ignored, await strava2.HandleEventAsync(
            new StravaEvent("activity", 99, "create", OwnerId: 777, SubscriptionId: 1, EventTime: DateTimeOffset.UtcNow.ToUnixTimeSeconds(), Updates: null)));
        Assert.True(await db.StravaConnections.AnyAsync());
    }

    [Fact]
    public async Task HealthConnect_BlocksDisabledAccounts_AndDeduplicatesSubMicrosecondTimestamps()
    {
        await using var db = NewInMemoryDb();
        db.Tenant.UseSystem();
        db.Households.Add(new Household { Id = 1, Name = "Dom" });
        db.People.AddRange(
            new Person { Id = 1, HouseholdId = 1, Name = "Active" },
            new Person { Id = 2, HouseholdId = 1, Name = "Blocked", BlockedAt = DateTimeOffset.UtcNow });
        await db.SaveChangesAsync();

        db.Tenant.UseHousehold(1);
        var activeSvc = new ActivityService(db, new PersonScope(1));
        var blockedSvc = new ActivityService(db, new PersonScope(2));
        var activeSync = await activeSvc.SyncAsync();
        var blockedSync = await blockedSvc.SyncAsync();

        Assert.NotNull(await activeSvc.AuthorizeAsync(activeSync.Token));
        Assert.Null(await blockedSvc.AuthorizeAsync(blockedSync.Token));

        // 7-digit fractional seconds (.1234567Z vs .1234560Z) truncate to same microsecond and deduplicate.
        var t1 = DateTimeOffset.Parse("2026-11-10T10:00:00.1234567Z");
        var t2 = DateTimeOffset.Parse("2026-11-10T10:30:00.1234567Z");
        var t1Micro = DateTimeOffset.Parse("2026-11-10T10:00:00.1234560Z");
        var t2Micro = DateTimeOffset.Parse("2026-11-10T10:30:00.1234560Z");
        await activeSvc.IngestAsync(activeSync, new HcPayload([new HcEnergy(150, t1, t2)], null, null, null));
        await activeSvc.IngestAsync(activeSync, new HcPayload([new HcEnergy(160, t1Micro, t2Micro)], null, null, null));

        var sample = Assert.Single(await db.EnergySamples.ToListAsync());
        Assert.Equal(160, sample.Kcal);
    }

    // ---- 4. Domain & Data Integrity ----

    [Fact]
    public async Task Preferences_GetIsReadOnly_AndPutWithEquipmentSavesCleanly()
    {
        await using var host = await BuildTestAppAsync();

        // GET on a fresh household must NOT create a Preferences row.
        var get = await host.SendAsync(HttpMethod.Get, "/api/preferences", email: MemberEmail);
        Assert.Equal(HttpStatusCode.OK, get.StatusCode);
        using (var scope = host.App.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<MiseDbContext>();
            db.Tenant.UseHousehold(2);
            Assert.False(await db.Preferences.AnyAsync());
        }

        // First PUT with equipment items succeeds (previously 500 DbUpdateConcurrencyException!).
        var put1 = await host.SendAsync(HttpMethod.Put, "/api/preferences", email: MemberEmail, body: new
        {
            householdSummary = "2 osoby",
            householdDetail = "",
            skillSummary = "średni",
            skillDetail = "",
            tasteCuisines = "włoska",
            avoidDietary = "",
            equipmentNote = "",
            equipment = new[]
            {
                new { name = "Air Fryer", favorite = true },
                new { name = "Blender", favorite = false },
            },
        });
        Assert.Equal(HttpStatusCode.OK, put1.StatusCode);

        // Second PUT replacing equipment items also succeeds cleanly.
        var put2 = await host.SendAsync(HttpMethod.Put, "/api/preferences", email: MemberEmail, body: new
        {
            householdSummary = "2 osoby",
            householdDetail = "",
            skillSummary = "średni",
            skillDetail = "",
            tasteCuisines = "polska",
            avoidDietary = "",
            equipmentNote = "",
            equipment = new[] { new { name = "Wok", favorite = true } },
        });
        Assert.Equal(HttpStatusCode.OK, put2.StatusCode);
        var body = await put2.Content.ReadAsStringAsync();
        Assert.Contains("Wok", body);
        Assert.DoesNotContain("Blender", body);
    }

    [Fact]
    public void ContextExport_SlugsFoldPolishDiacritics_CapLength_AndPrefixWindowsReservedNames()
    {
        Assert.Equal("zolty-zurek-z-lososiem", ContextExportService.Slugify("Żółty żurek z łososiem"));
        Assert.Equal("r-con", ContextExportService.Slugify("CON"));
        Assert.Equal("r-nul", ContextExportService.Slugify("nul"));
        var longSlug = ContextExportService.Slugify(new string('a', 300));
        Assert.True(longSlug.Length <= 80);
    }

    [Theory]
    [InlineData("Masło", "Maślanka")]
    [InlineData("Kasza", "Kaszanka")]
    [InlineData("Papryka", "Paprykarz")]
    [InlineData("Ciasto", "Ciastka")]
    [InlineData("Pomidor", "Pomidorowa")]
    [InlineData("Oliwa", "Oliwki")]
    [InlineData("Pesto", "Pestki")]
    [InlineData("Woda", "Wódka")]
    public void IngredientMatcher_DistinctPolishFoods_NeverCollide(string pantryName, string ingredientName)
    {
        var matcher = new IngredientMatcher();
        var pantry = new[] { new PantryItem { Name = pantryName } };
        Assert.Null(matcher.FindMatch(ingredientName, pantry, IngredientMatcher.ExactishScore));
        Assert.Null(matcher.FindMatch(ingredientName, pantry));
    }

    [Fact]
    public void IngredientMatcher_ExactishInflectedMatch_BeatsPartialRawTokenOverlap()
    {
        var matcher = new IngredientMatcher();
        var butter = new PantryItem { Name = "Masło" };
        var peanutButter = new PantryItem { Name = "Masło orzechowe" };
        // "Masło" has 1 raw token match (score 71), "Masło orzechowe" has 0 raw matches on inflected "Masła orzechowego" (score 85).
        var match = matcher.FindMatch("Masła orzechowego", [butter, peanutButter], IngredientMatcher.ExactishScore);
        Assert.Equal(peanutButter.Id, match?.Id);
    }

    [Fact]
    public void IngredientMatcher_RelinkIngredients_DoesNotForceLoosePartialLinks()
    {
        var matcher = new IngredientMatcher();
        var water = new PantryItem { Name = "Woda" };
        var ing = new RecipeIngredient { Name = "Woda różana" };
        matcher.RelinkIngredients([ing], [water]);
        Assert.Null(ing.PantryItemId);
    }

    [Fact]
    public async Task CateringService_BoundsStartDate_AndMovingStartBackNeverResurrectsDeletedDay()
    {
        await using var db = NewInMemoryDb();
        var today = new DateOnly(2026, 11, 20);
        var svc = new CateringService(db, new PersonScope(1));

        await Assert.ThrowsAsync<DiaryException>(() =>
            svc.SaveAsync(true, 2000, null, null, null, CateringService.AllWeekdays, today.AddYears(-5), today));

        // Materialize Nov 18, 19, 20, then delete Nov 19 ("dziś bez cateringu").
        await svc.SaveAsync(true, 2000, null, null, null, CateringService.AllWeekdays, today.AddDays(-2), today);
        var deletedDay = await db.PlanEntries.SingleAsync(e => e.Date == today.AddDays(-1));
        db.PlanEntries.Remove(deletedDay);
        await db.SaveChangesAsync();

        // Moving start back to Nov 16 should add Nov 16 & 17, but NOT resurrect Nov 19!
        await svc.SaveAsync(true, 2000, null, null, null, CateringService.AllWeekdays, today.AddDays(-4), today);
        var dates = await db.PlanEntries.Where(e => e.IsCatering).OrderBy(e => e.Date).Select(e => e.Date).ToListAsync();
        Assert.Equal([today.AddDays(-4), today.AddDays(-3), today.AddDays(-2), today], dates);
    }

    [Fact]
    public async Task TrainingPatch_RejectsExtremeStartDate_AndPropagatesTimedSwapToFollowingWeeks()
    {
        await using var host = await BuildTestAppAsync();
        var repId = host.SharedExerciseId;
        var timedId = host.TimedExerciseId;
        var monday = new DateOnly(2026, 11, 16);

        var create = await host.SendAsync(HttpMethod.Post, "/api/training/programs", email: AdminEmail, body: new
        {
            name = "Test plan",
            startDate = monday,
            weeks = 2,
            activate = true,
            days = new object[]
            {
                new { week = 1, weekday = 0, name = "Dzień A", exercises = new[] { new { exerciseId = repId, sets = 3, repsMin = 10, repsMax = 12 } } },
                new { week = 2, weekday = 0, name = "Dzień A", exercises = new[] { new { exerciseId = repId, sets = 3, repsMin = 10, repsMax = 12 } } },
            },
        });
        Assert.Equal(HttpStatusCode.Created, create.StatusCode);
        using var createdDoc = JsonDocument.Parse(await create.Content.ReadAsStringAsync());
        var programId = createdDoc.RootElement.GetProperty("id").GetGuid();
        var week1SlotId = createdDoc.RootElement.GetProperty("days")[0].GetProperty("exercises")[0].GetProperty("id").GetGuid();

        // Extreme StartDate must be rejected with 400.
        var badPatch = await host.SendAsync(HttpMethod.Patch, $"/api/training/programs/{programId}", email: AdminEmail,
            body: new { startDate = new DateOnly(2099, 1, 1) });
        Assert.Equal(HttpStatusCode.BadRequest, badPatch.StatusCode);

        // Swapping rep exercise → timed exercise with explicit seconds=45 + applyToFollowingWeeks=true
        // must update week 2 to seconds=45 and null reps (not leave stale repsMin=10 on a timed exercise!).
        var swap = await host.SendAsync(HttpMethod.Patch, $"/api/training/program-exercises/{week1SlotId}", email: AdminEmail,
            body: new { exerciseId = timedId, seconds = 45, applyToFollowingWeeks = true });
        Assert.Equal(HttpStatusCode.OK, swap.StatusCode);
        using var swapDoc = JsonDocument.Parse(await swap.Content.ReadAsStringAsync());
        var week2Ex = swapDoc.RootElement.GetProperty("program").GetProperty("days")[1].GetProperty("exercises")[0];
        Assert.Equal(45, week2Ex.GetProperty("seconds").GetInt32());
        Assert.Equal(JsonValueKind.Null, week2Ex.GetProperty("repsMin").ValueKind);
        Assert.Equal(JsonValueKind.Null, week2Ex.GetProperty("repsMax").ValueKind);
    }

    [Fact]
    public async Task ShoppingService_SequentialRecipes_AccountForCommittedDemand()
    {
        await using var db = NewInMemoryDb();
        var chicken = new PantryItem { Name = "Kurczak", Unit = PantryUnit.G, Quantity = 400, ReliableQuantity = 400, ReliabilityUpdatedAt = DateTimeOffset.UtcNow };
        db.PantryItems.Add(chicken);
        await db.SaveChangesAsync();

        var recipeA = new Recipe
        {
            Title = "Curry",
            Servings = 1,
            Ingredients = [new RecipeIngredient { Name = "Kurczak", AmountValue = 500, AmountUnit = PantryUnit.G, PantryItemId = chicken.Id }],
        };
        var recipeB = new Recipe
        {
            Title = "Sałatka",
            Servings = 1,
            Ingredients = [new RecipeIngredient { Name = "Kurczak", AmountValue = 200, AmountUnit = PantryUnit.G, PantryItemId = chicken.Id }],
        };
        var shopping = new ShoppingService();

        // Recipe A needs 500 g vs 400 g stock → adds row with 100 g missing.
        await shopping.AddMissingForRecipesAsync(db, [new ShoppingRecipeSource($"recipe:{recipeA.Id}", recipeA.Title, recipeA)]);
        // Recipe B needs 200 g (< 400 g alone, but 500+200 = 700 > 400 combined!) → must update row to 300 g missing!
        await shopping.AddMissingForRecipesAsync(db, [new ShoppingRecipeSource($"recipe:{recipeB.Id}", recipeB.Title, recipeB)]);

        var row = await db.ShoppingItems.Include(s => s.Contributions).SingleAsync();
        Assert.Equal(300, row.Quantity);
        Assert.Equal(2, row.Contributions.Count);
    }

    [Fact]
    public async Task RecipesEndpoints_ZeroGramMacros_ArePreserved()
    {
        await using var host = await BuildTestAppAsync();
        var res = await host.SendAsync(HttpMethod.Post, "/api/recipes", email: AdminEmail, body: new
        {
            title = "Oliwa z ziołami",
            source = "manual",
            time = 5,
            servings = 1,
            kcal = 120,
            protein = 0,
            fat = 14,
            carbs = 0,
            ingredients = new[] { new { name = "Oliwa z oliwek", quantity = "15 ml" } },
            steps = new[] { "Wymieszaj." },
        });
        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
        using var created = JsonDocument.Parse(await res.Content.ReadAsStringAsync());
        var id = created.RootElement.GetProperty("id").GetGuid();

        var detail = await host.SendAsync(HttpMethod.Get, $"/api/recipes/{id}", email: AdminEmail);
        Assert.Equal(HttpStatusCode.OK, detail.StatusCode);
        using var doc = JsonDocument.Parse(await detail.Content.ReadAsStringAsync());
        Assert.Equal(0m, doc.RootElement.GetProperty("protein").GetDecimal());
        Assert.Equal(14m, doc.RootElement.GetProperty("fat").GetDecimal());
        Assert.Equal(0m, doc.RootElement.GetProperty("carbs").GetDecimal());
    }

    [Fact]
    public void QuantityParser_AndRecipeScaling_DoNotOverflowOnHugeNumbers()
    {
        Assert.False(QuantityParser.TryParse("99999999999999999999999999999999 kg", out _, out _));
        Assert.Equal("99999999999999999999999999999999 g",
            RecipeScaling.ScaleText("99999999999999999999999999999999 g", 4, 2));
    }

    [Theory]
    [InlineData("Kapsułki do prania", SupplyCategory.Cleaning)]
    [InlineData("Tabletki do zmywarki", SupplyCategory.Cleaning)]
    [InlineData("Nabłyszczacz do zmywarki", SupplyCategory.Cleaning)]
    public void SupplyService_FixedCleaningRegexes_ClassifyCorrectly(string name, SupplyCategory expected)
        => Assert.Equal(expected, SupplyService.Guess(name));

    [Fact]
    public async Task FirstSteps_ShortCircuitsWhenDismissed()
    {
        await using var db = NewInMemoryDb();
        db.Tenant.UseSystem();
        db.Households.Add(new Household { Id = 1, Name = "Dom" });
        var person = new Person { Id = 1, HouseholdId = 1, Name = "Ania", FirstStepsDismissedAt = DateTimeOffset.UtcNow };
        db.People.Add(person);
        await db.SaveChangesAsync();

        db.Tenant.UseHousehold(1);
        var info = new PersonInfo(1, person.Name, person.Email, 1, HouseholdRole.Owner, IsAdmin: false, Blocked: false);
        var caller = new Caller { Kind = CallerKind.Member, HouseholdId = 1, Self = info, Acting = info, People = [info] };
        var dto = await FirstSteps.BuildAsync(db, caller);
        Assert.False(dto.Show);
        Assert.Empty(dto.Steps);
    }

    [Fact]
    public void EfCore_PostgreSqlModelMatchesSnapshot_WithNoPendingMigrations()
    {
        var opts = new DbContextOptionsBuilder<MiseDbContext>()
            .UseNpgsql("Host=localhost;Port=5432;Database=mise;Username=mise;Password=mise")
            .Options;
        using var db = new MiseDbContext(opts);
        Assert.False(db.Database.HasPendingModelChanges(),
            "EF Core detected pending model changes — regenerate or add a migration so startup MigrateAsync() does not fail.");
    }

    [Fact]
    public async Task Swagger_OpenApiDocumentGeneratesCleanlyOnNet10()
    {
        await using var host = await BuildTestAppAsync();
        var res = await host.SendAsync(HttpMethod.Get, "/api/swagger/v1/swagger.json", email: AdminEmail);
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync());
        Assert.Equal("Pichci API", doc.RootElement.GetProperty("info").GetProperty("title").GetString());
    }

    // ---- 5. Batch A — Cookbook Superpowers (#1, #6, #9) ----

    [Fact]
    public async Task Recipes_FavoritesTagsIngredientSearchBudgetAndPutPreservation()
    {
        await using var host = await BuildTestAppAsync();

        var create1 = await host.SendAsync(HttpMethod.Post, "/api/recipes", email: AdminEmail, body: new
        {
            title = "Naleśniki białkowe",
            source = "manual",
            time = 20,
            servings = 2,
            kcal = 420,
            protein = 35,
            fat = 10,
            carbs = 42,
            tags = new[] { "Do Pudełka", "#szybkie", "szybkie" },
            ingredients = new[]
            {
                new { name = "Twaróg chudy", quantity = "200 g", amountValue = 200m, amountUnit = "g" },
                new { name = "Szpinak", quantity = "100 g", amountValue = 100m, amountUnit = "g" },
            },
            steps = new[] { "Wymieszaj i usmaż." },
        });
        Assert.Equal(HttpStatusCode.Created, create1.StatusCode);
        var id1 = JsonDocument.Parse(await create1.Content.ReadAsStringAsync()).RootElement.GetProperty("id").GetGuid();

        var create2 = await host.SendAsync(HttpMethod.Post, "/api/recipes", email: AdminEmail, body: new
        {
            title = "Makaron carbonara",
            source = "web",
            time = 25,
            servings = 2,
            kcal = 720,
            protein = 22,
            fat = 32,
            carbs = 78,
            ingredients = new[]
            {
                new { name = "Makaron", quantity = "200 g" },
                new { name = "Guanciale", quantity = "100 g" },
            },
            steps = new[] { "Ugotuj makaron." },
        });
        Assert.Equal(HttpStatusCode.Created, create2.StatusCode);

        // Favorite toggle + filter
        var fav = await host.SendAsync(HttpMethod.Put, $"/api/recipes/{id1}/favorite", email: AdminEmail, body: new { favorite = true });
        Assert.Equal(HttpStatusCode.OK, fav.StatusCode);
        var favList = JsonDocument.Parse(await (await host.SendAsync(HttpMethod.Get, "/api/recipes?favorite=true", email: AdminEmail)).Content.ReadAsStringAsync());
        Assert.Equal(id1, Assert.Single(favList.RootElement.EnumerateArray()).GetProperty("id").GetGuid());

        // Tag normalization + diacritic-insensitive tag filter + >15 validation
        var detail1 = JsonDocument.Parse(await (await host.SendAsync(HttpMethod.Get, $"/api/recipes/{id1}?base=true", email: AdminEmail)).Content.ReadAsStringAsync());
        Assert.Equal(["do pudełka", "szybkie"], detail1.RootElement.GetProperty("tags").EnumerateArray().Select(x => x.GetString()!).ToArray());
        Assert.True(detail1.RootElement.GetProperty("isFavorite").GetBoolean());
        // Base detail exposes structured amountValue/amountUnit for editor round-trip!
        var firstIng = detail1.RootElement.GetProperty("ingredients")[0];
        Assert.Equal(200m, firstIng.GetProperty("amountValue").GetDecimal());
        Assert.Equal("g", firstIng.GetProperty("amountUnit").GetString());

        var byTag = JsonDocument.Parse(await (await host.SendAsync(HttpMethod.Get, "/api/recipes?tag=do+pudelka", email: AdminEmail)).Content.ReadAsStringAsync());
        Assert.Equal(id1, Assert.Single(byTag.RootElement.EnumerateArray()).GetProperty("id").GetGuid());

        var tooManyTags = await host.SendAsync(HttpMethod.Put, $"/api/recipes/{id1}/tags", email: AdminEmail,
            body: new { tags = Enumerable.Range(1, 16).Select(i => $"tag{i}").ToArray() });
        Assert.Equal(HttpStatusCode.BadRequest, tooManyTags.StatusCode);

        // Multi-word diacritic-insensitive ingredient search via both ?q= and ?ingredient=
        var byQ = JsonDocument.Parse(await (await host.SendAsync(HttpMethod.Get, "/api/recipes?q=twarog+szpinak", email: AdminEmail)).Content.ReadAsStringAsync());
        Assert.Equal(id1, Assert.Single(byQ.RootElement.EnumerateArray()).GetProperty("id").GetGuid());

        var byIng = JsonDocument.Parse(await (await host.SendAsync(HttpMethod.Get, "/api/recipes?ingredient=twaróg,szpinak", email: AdminEmail)).Content.ReadAsStringAsync());
        Assert.Equal(id1, Assert.Single(byIng.RootElement.EnumerateArray()).GetProperty("id").GetGuid());

        // Budget filter (?maxKcal=500&minProtein=30)
        var byBudget = JsonDocument.Parse(await (await host.SendAsync(HttpMethod.Get, "/api/recipes?maxKcal=500&minProtein=30", email: AdminEmail)).Content.ReadAsStringAsync());
        Assert.Equal(id1, Assert.Single(byBudget.RootElement.EnumerateArray()).GetProperty("id").GetGuid());

        // PUT omitting isFavorite & tags preserves both; PUT with tags: [] clears tags while keeping isFavorite.
        var putKeep = await host.SendAsync(HttpMethod.Put, $"/api/recipes/{id1}", email: AdminEmail, body: new
        {
            title = "Naleśniki białkowe v2",
            source = "manual",
            time = 20,
            servings = 2,
            kcal = 420,
            protein = 35,
            fat = 10,
            carbs = 42,
            ingredients = new[] { new { name = "Twaróg chudy", quantity = "200 g" } },
            steps = new[] { "Wymieszaj." },
        });
        Assert.Equal(HttpStatusCode.NoContent, putKeep.StatusCode);
        var afterKeep = JsonDocument.Parse(await (await host.SendAsync(HttpMethod.Get, $"/api/recipes/{id1}", email: AdminEmail)).Content.ReadAsStringAsync());
        Assert.True(afterKeep.RootElement.GetProperty("isFavorite").GetBoolean());
        Assert.Equal(["do pudełka", "szybkie"], afterKeep.RootElement.GetProperty("tags").EnumerateArray().Select(x => x.GetString()!).ToArray());

        var putClearTags = await host.SendAsync(HttpMethod.Put, $"/api/recipes/{id1}", email: AdminEmail, body: new
        {
            title = "Naleśniki białkowe v3",
            source = "manual",
            time = 20,
            servings = 2,
            tags = Array.Empty<string>(),
            ingredients = new[] { new { name = "Twaróg chudy", quantity = "200 g" } },
            steps = new[] { "Wymieszaj." },
        });
        Assert.Equal(HttpStatusCode.NoContent, putClearTags.StatusCode);
        var afterClear = JsonDocument.Parse(await (await host.SendAsync(HttpMethod.Get, $"/api/recipes/{id1}", email: AdminEmail)).Content.ReadAsStringAsync());
        Assert.True(afterClear.RootElement.GetProperty("isFavorite").GetBoolean());
        Assert.Empty(afterClear.RootElement.GetProperty("tags").EnumerateArray());
    }

    [Fact]
    public async Task HouseholdProvisioner_StarterCopy_ResetsFavoriteAndClonesTags()
    {
        await using var host = await BuildTestAppAsync();
        using var scope = host.App.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<MiseDbContext>();
        var provisioner = scope.ServiceProvider.GetRequiredService<HouseholdProvisioner>();

        db.Tenant.UseHousehold(1);
        db.Recipes.Add(new Recipe
        {
            Title = "Zupa dyniowa",
            Source = RecipeSource.Manual,
            IsFavorite = true,
            Tags = ["jesień", "do pudełka"],
            Ingredients = [new RecipeIngredient { Name = "Dynia", Quantity = "500 g", Order = 0 }],
            Steps = [new RecipeStep { Text = "Ugotuj.", Order = 0 }],
        });
        await db.SaveChangesAsync();

        var newHouse = await provisioner.CreateAsync("Dom 3", StarterMode.All, [], sourceHouseholdId: 1);
        db.Tenant.UseHousehold(newHouse.Id);
        var copied = await db.Recipes.SingleAsync(r => r.Title == "Zupa dyniowa");
        Assert.False(copied.IsFavorite);
        Assert.Equal(["jesień", "do pudełka"], copied.Tags);
    }

    // ---- 6. Batch B — Couples Sync, Live/Offline Shopping, Bought→Pantry, Catering Pauses & Split ----

    [Fact]
    public async Task CouplesSync_PlanEntriesAndCooks_ScaleMacrosAndCombineShoppingDemand()
    {
        await using var host = await BuildTestAppAsync();

        // Pantry + recipe with 100 g Ryż per serving
        var pRes = await host.SendAsync(HttpMethod.Post, "/api/pantry", email: AdminEmail, body: new
        {
            name = "Ryż", category = "Pantry", unit = "g", quantity = 0m,
        });
        Assert.Equal(HttpStatusCode.Created, pRes.StatusCode);

        var rRes = await host.SendAsync(HttpMethod.Post, "/api/recipes", email: AdminEmail, body: new
        {
            title = "Bowl z ryżem",
            source = "manual",
            time = 15,
            servings = 1,
            kcal = 500,
            protein = 30,
            fat = 10,
            carbs = 70,
            ingredients = new[] { new { name = "Ryż", quantity = "100 g", amountValue = 100m, amountUnit = "g" } },
            steps = new[] { "Ugotuj ryż." },
        });
        Assert.Equal(HttpStatusCode.Created, rRes.StatusCode);
        var recipeId = JsonDocument.Parse(await rRes.Content.ReadAsStringAsync()).RootElement.GetProperty("id").GetGuid();

        // 1. Typed meal synced to ActivePartner (person 4) at 1.5× portion
        var mealDate = new DateOnly(2026, 12, 1);
        var addTyped = await host.SendAsync(HttpMethod.Post, "/api/plan/entries", email: AdminEmail, body: new
        {
            date = mealDate,
            slot = "breakfast",
            title = "Owsianka",
            kcal = 400,
            protein = 20m,
            fat = 8m,
            carbs = 60m,
            grams = 80m,
            eaten = true,
            alsoFor = new[] { new { personId = 4, portions = 1.5m } },
        });
        Assert.Equal(HttpStatusCode.OK, addTyped.StatusCode);

        var partnerPlan = JsonDocument.Parse(await (await host.SendAsync(HttpMethod.Get, $"/api/plan?start={mealDate:yyyy-MM-dd}&days=2",
            email: AdminEmail, xPerson: "4")).Content.ReadAsStringAsync());
        var syncedEntry = Assert.Single(partnerPlan.RootElement.GetProperty("entries").EnumerateArray());
        Assert.Equal("Owsianka", syncedEntry.GetProperty("title").GetString());
        Assert.Equal(600, syncedEntry.GetProperty("kcal").GetInt32());
        Assert.Equal(30m, syncedEntry.GetProperty("protein").GetDecimal());
        Assert.Equal(120m, syncedEntry.GetProperty("grams").GetDecimal());
        Assert.Equal(1m, syncedEntry.GetProperty("portions").GetDecimal());
        Assert.True(syncedEntry.GetProperty("eaten").GetBoolean());

        // Single recipe entry synced to ActivePartner preserves partner portions (1.5×) and scales recipe kcal (500 × 1.5 = 750)
        var addRecipeEntry = await host.SendAsync(HttpMethod.Post, "/api/plan/entries", email: AdminEmail, body: new
        {
            date = mealDate,
            slot = "dinner",
            recipeId,
            portions = 1m,
            eaten = true,
            alsoFor = new[] { new { personId = 4, portions = 1.5m } },
        });
        Assert.Equal(HttpStatusCode.OK, addRecipeEntry.StatusCode);
        var partnerAfterRecipe = JsonDocument.Parse(await (await host.SendAsync(HttpMethod.Get, $"/api/plan?start={mealDate:yyyy-MM-dd}&days=2",
            email: AdminEmail, xPerson: "4")).Content.ReadAsStringAsync());
        var syncedDinner = partnerAfterRecipe.RootElement.GetProperty("entries").EnumerateArray()
            .Single(e => e.GetProperty("slot").GetString() == "dinner");
        Assert.Equal(1.5m, syncedDinner.GetProperty("portions").GetDecimal());
        Assert.Equal(750, syncedDinner.GetProperty("kcal").GetInt32());

        // 2. Security guards: cross-household (person 3) and blocked member (person 2) must be rejected with 400
        var crossHouse = await host.SendAsync(HttpMethod.Post, "/api/plan/entries", email: AdminEmail, body: new
        {
            date = mealDate, slot = "snack", title = "Jabłko", kcal = 80, eaten = true,
            alsoFor = new[] { new { personId = 3, portions = 1m } },
        });
        Assert.Equal(HttpStatusCode.BadRequest, crossHouse.StatusCode);

        var blockedPartner = await host.SendAsync(HttpMethod.Post, "/api/plan/entries", email: AdminEmail, body: new
        {
            date = mealDate, slot = "snack", title = "Jabłko", kcal = 80, eaten = true,
            alsoFor = new[] { new { personId = 2, portions = 1m } },
        });
        Assert.Equal(HttpStatusCode.BadRequest, blockedPartner.StatusCode);

        // 3. Batch cook synced to ActivePartner (2 days: Admin 2 portions, ActivePartner 1.5×/day → 3-portion pot)
        var cookRes = await host.SendAsync(HttpMethod.Post, "/api/diary/cooks", email: AdminEmail, body: new
        {
            recipeId,
            portions = 2,
            firstDate = mealDate,
            firstSlot = "lunch",
            assignments = new[] { new { date = mealDate.AddDays(1), slot = "lunch" } },
            alsoFor = new[] { new { personId = 4, portions = 1.5m } },
        });
        Assert.Equal(HttpStatusCode.OK, cookRes.StatusCode);

        var partnerAfterCook = JsonDocument.Parse(await (await host.SendAsync(HttpMethod.Get, $"/api/plan?start={mealDate:yyyy-MM-dd}&days=2",
            email: AdminEmail, xPerson: "4")).Content.ReadAsStringAsync());
        var cookEntries = partnerAfterCook.RootElement.GetProperty("entries").EnumerateArray()
            .Where(e => e.GetProperty("cookId").ValueKind == JsonValueKind.String)
            .OrderBy(e => e.GetProperty("date").GetString())
            .ToList();
        Assert.Equal(2, cookEntries.Count);
        Assert.False(cookEntries[0].GetProperty("isLeftover").GetBoolean());
        Assert.True(cookEntries[1].GetProperty("isLeftover").GetBoolean());
        Assert.Equal(1.5m, cookEntries[0].GetProperty("portions").GetDecimal());
        Assert.Equal(1.5m, cookEntries[1].GetProperty("portions").GetDecimal());

        // Plan shopping preview sums both people's cook-day pots (2 + 3 = 5 portions × 100 g = 500 g, no leftover double-count)
        var preview = JsonDocument.Parse(await (await host.SendAsync(HttpMethod.Get,
            $"/api/plan/shopping-preview?start={mealDate:yyyy-MM-dd}&days=2", email: AdminEmail)).Content.ReadAsStringAsync());
        var rice = Assert.Single(preview.RootElement.GetProperty("items").EnumerateArray());
        Assert.Equal(500m, rice.GetProperty("requiredQuantity").GetDecimal());
    }

    [Fact]
    public async Task Shopping_ExposesPantryItemId_IdempotentCheck_AndOptInAdjustAddsDelta()
    {
        await using var host = await BuildTestAppAsync();

        var pRes = await host.SendAsync(HttpMethod.Post, "/api/pantry", email: AdminEmail, body: new
        {
            name = "Mleko", category = "Fridge", unit = "ml", quantity = 200m,
        });
        Assert.Equal(HttpStatusCode.Created, pRes.StatusCode);
        var milkId = JsonDocument.Parse(await pRes.Content.ReadAsStringAsync()).RootElement.GetProperty("id").GetGuid();

        var addShop = await host.SendAsync(HttpMethod.Post, "/api/shopping", email: AdminEmail, body: new { name = "Mleko" });
        Assert.Equal(HttpStatusCode.Created, addShop.StatusCode);
        var shopId = JsonDocument.Parse(await addShop.Content.ReadAsStringAsync()).RootElement.GetProperty("id").GetGuid();

        // Explicit checked=true is idempotent across repeated offline/live replays
        var check1 = await host.SendAsync(HttpMethod.Patch, $"/api/shopping/{shopId}/check", email: AdminEmail, body: new { @checked = true });
        var check2 = await host.SendAsync(HttpMethod.Patch, $"/api/shopping/{shopId}/check", email: AdminEmail, body: new { @checked = true });
        Assert.Equal(HttpStatusCode.OK, check1.StatusCode);
        Assert.Equal(HttpStatusCode.OK, check2.StatusCode);
        Assert.True(JsonDocument.Parse(await check2.Content.ReadAsStringAsync()).RootElement.GetProperty("checked").GetBoolean());

        // GET /api/shopping exposes pantryItemId, and checking off never mutates pantry stock silently
        var list = JsonDocument.Parse(await (await host.SendAsync(HttpMethod.Get, "/api/shopping", email: AdminEmail)).Content.ReadAsStringAsync());
        var row = Assert.Single(list.RootElement.GetProperty("items").EnumerateArray());
        Assert.Equal(milkId, row.GetProperty("pantryItemId").GetGuid());

        var pantryBefore = JsonDocument.Parse(await (await host.SendAsync(HttpMethod.Get, "/api/pantry", email: AdminEmail)).Content.ReadAsStringAsync());
        Assert.Equal(200m, pantryBefore.RootElement[0].GetProperty("items")[0].GetProperty("quantity").GetDecimal());

        // Opt-in BoughtToPantrySheet posts one /pantry/adjust delta
        var adj = await host.SendAsync(HttpMethod.Post, "/api/pantry/adjust", email: AdminEmail, body: new
        {
            items = new[] { new { name = "Mleko", quantity = 1000m, unit = "ml", pantryItemId = milkId } },
        });
        Assert.Equal(HttpStatusCode.OK, adj.StatusCode);
        var adjDoc = JsonDocument.Parse(await adj.Content.ReadAsStringAsync());
        Assert.Equal(1200m, Assert.Single(adjDoc.RootElement.GetProperty("updated").EnumerateArray()).GetProperty("quantity").GetDecimal());
    }

    [Fact]
    public async Task Catering_PausesSkipAutoMaterialization_AndDropTodayBoxImmediately()
    {
        await using var host = await BuildTestAppAsync();
        var today = DateOnly.FromDateTime(DateTime.Today);

        var save = await host.SendAsync(HttpMethod.Put, "/api/body/catering", email: AdminEmail, body: new
        {
            enabled = true,
            kcal = 2000,
            weekdays = CateringService.AllWeekdays,
            startDate = today.AddDays(-1),
            splitMeals = false,
        });
        Assert.Equal(HttpStatusCode.OK, save.StatusCode);

        // Invalid range (to < from) rejected
        var badPause = await host.SendAsync(HttpMethod.Post, "/api/body/catering/pauses", email: AdminEmail, body: new
        {
            from = today.AddDays(3), to = today.AddDays(1), note = "Zły zakres",
        });
        Assert.Equal(HttpStatusCode.BadRequest, badPause.StatusCode);

        // Adding pause covering today..today+2 drops today's box immediately
        var pauseRes = await host.SendAsync(HttpMethod.Post, "/api/body/catering/pauses", email: AdminEmail, body: new
        {
            from = today, to = today.AddDays(2), note = "Urlop",
        });
        Assert.Equal(HttpStatusCode.Created, pauseRes.StatusCode);
        var pauseId = JsonDocument.Parse(await pauseRes.Content.ReadAsStringAsync()).RootElement.GetProperty("id").GetGuid();

        var getCat = JsonDocument.Parse(await (await host.SendAsync(HttpMethod.Get, "/api/body/catering", email: AdminEmail)).Content.ReadAsStringAsync());
        var pauseDto = Assert.Single(getCat.RootElement.GetProperty("pauses").EnumerateArray());
        Assert.Equal("Urlop", pauseDto.GetProperty("note").GetString());

        // EnsureAsync on paused day (today+1) skips it; day after pause (today+3) is materialized
        using (var scope = host.App.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<MiseDbContext>();
            db.Tenant.UseHousehold(1);
            var svc = new CateringService(db, new PersonScope(1));
            await svc.EnsureAsync(today.AddDays(1));
            await svc.EnsureAsync(today.AddDays(3));
            var dates = await db.PlanEntries.Where(e => e.IsCatering && e.PersonId == 1)
                .OrderBy(e => e.Date).Select(e => e.Date).ToListAsync();
            Assert.Contains(today.AddDays(-1), dates);
            Assert.DoesNotContain(today, dates);
            Assert.DoesNotContain(today.AddDays(1), dates);
            Assert.DoesNotContain(today.AddDays(2), dates);
            Assert.Contains(today.AddDays(3), dates);
        }

        var delPause = await host.SendAsync(HttpMethod.Delete, $"/api/body/catering/pauses/{pauseId}", email: AdminEmail);
        Assert.Equal(HttpStatusCode.NoContent, delPause.StatusCode);
    }

    [Fact]
    public async Task Catering_SplitMeals_DividesIntoExact30_40_30AcrossThreeSlots_AndDeleteDayClearsAll()
    {
        await using var host = await BuildTestAppAsync();
        var today = DateOnly.FromDateTime(DateTime.Today);

        var save = await host.SendAsync(HttpMethod.Put, "/api/body/catering", email: AdminEmail, body: new
        {
            enabled = true,
            kcal = 2001,
            protein = 120.5m,
            fat = 65.3m,
            carbs = 210.7m,
            weekdays = CateringService.AllWeekdays,
            startDate = today,
            splitMeals = true,
        });
        Assert.Equal(HttpStatusCode.OK, save.StatusCode);

        var planDoc = JsonDocument.Parse(await (await host.SendAsync(HttpMethod.Get,
            $"/api/plan?start={today:yyyy-MM-dd}&days=1", email: AdminEmail)).Content.ReadAsStringAsync());
        var boxes = planDoc.RootElement.GetProperty("entries").EnumerateArray()
            .Where(e => e.GetProperty("isCatering").GetBoolean())
            .ToList();
        Assert.Equal(3, boxes.Count);
        Assert.Equal(["breakfast", "dinner", "lunch"], boxes.Select(b => b.GetProperty("slot").GetString()!).OrderBy(s => s).ToArray());
        Assert.Equal(2001, boxes.Sum(b => b.GetProperty("kcal").GetInt32()));
        Assert.Equal(120.5m, boxes.Sum(b => b.GetProperty("protein").GetDecimal()));
        Assert.Equal(65.3m, boxes.Sum(b => b.GetProperty("fat").GetDecimal()));
        Assert.Equal(210.7m, boxes.Sum(b => b.GetProperty("carbs").GetDecimal()));

        // DELETE /api/body/catering/day/{today} removes all 3 split meals cleanly
        var delDay = await host.SendAsync(HttpMethod.Delete, $"/api/body/catering/day/{today:yyyy-MM-dd}", email: AdminEmail);
        Assert.Equal(HttpStatusCode.NoContent, delDay.StatusCode);

        var afterDel = JsonDocument.Parse(await (await host.SendAsync(HttpMethod.Get,
            $"/api/plan?start={today:yyyy-MM-dd}&days=1", email: AdminEmail)).Content.ReadAsStringAsync());
        Assert.DoesNotContain(afterDel.RootElement.GetProperty("entries").EnumerateArray(),
            e => e.GetProperty("isCatering").GetBoolean());

        // POST /api/body/catering/log re-creates all 3 split meals for the day
        var relog = await host.SendAsync(HttpMethod.Post, "/api/body/catering/log", email: AdminEmail, body: new { date = today });
        Assert.Equal(HttpStatusCode.OK, relog.StatusCode);
        var afterRelog = JsonDocument.Parse(await (await host.SendAsync(HttpMethod.Get,
            $"/api/plan?start={today:yyyy-MM-dd}&days=1", email: AdminEmail)).Content.ReadAsStringAsync());
        Assert.Equal(3, afterRelog.RootElement.GetProperty("entries").EnumerateArray()
            .Count(e => e.GetProperty("isCatering").GetBoolean()));
    }

    // ---- 7. Batch C — Sous Vision (#4), Cross-Household Recipe Sharing (#7), Admin Ops & ZIP Export (#13) ----

    [Fact]
    public async Task ChatVision_UploadsValidImage_BlocksCrossTenantIds_AndForwardsToProvider()
    {
        await using var host = await BuildTestAppAsync();
        using (var scope = host.App.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<MiseDbContext>();
            db.Tenant.UseSystem();
            foreach (var h in await db.Households.ToListAsync()) h.SousEnabled = true;
            await db.SaveChangesAsync();
        }

        // Invalid non-image rejected with 400
        var bad = await host.SendFileAsync("/api/chat/images", "bad.jpg", "image/jpeg",
            Encoding.UTF8.GetBytes("not an image"), email: AdminEmail);
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);

        // Valid PNG decoded, EXIF-stripped, and stored as JPEG
        var png = MakeTestPng();
        var ok = await host.SendFileAsync("/api/chat/images", "paragon.png", "image/png", png, email: AdminEmail);
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        var uploaded = JsonDocument.Parse(await ok.Content.ReadAsStringAsync()).RootElement;
        var imageId = uploaded.GetProperty("id").GetGuid();
        Assert.Equal("paragon.png", uploaded.GetProperty("name").GetString());
        Assert.True(uploaded.GetProperty("bytes").GetInt32() > 0);

        // Another household (Member) and another person in the same household (ActivePartner) cannot use Admin's imageId
        var crossHousehold = await host.SendAsync(HttpMethod.Post, "/api/chat", email: MemberEmail, body: new
        {
            message = "Sprawdź", imageIds = new[] { imageId },
        });
        Assert.Equal(HttpStatusCode.BadRequest, crossHousehold.StatusCode);

        var crossPerson = await host.SendAsync(HttpMethod.Post, "/api/chat", email: "partner@example.com", body: new
        {
            message = "Sprawdź", imageIds = new[] { imageId },
        });
        Assert.Equal(HttpStatusCode.BadRequest, crossPerson.StatusCode);

        // Owner sends photo with empty text → provider receives JPEG base64 attachment and history records camera marker
        var chat = await host.SendAsync(HttpMethod.Post, "/api/chat", email: AdminEmail, body: new
        {
            message = "", imageIds = new[] { imageId },
        });
        Assert.Equal(HttpStatusCode.OK, chat.StatusCode);
        var sse = await chat.Content.ReadAsStringAsync();
        var deltaText = string.Concat(sse.Split('\n')
            .Where(l => l.StartsWith("data:"))
            .Select(l => JsonDocument.Parse(l["data:".Length..].Trim()).RootElement)
            .Where(el => el.TryGetProperty("delta", out _))
            .Select(el => el.GetProperty("delta").GetString()));
        Assert.Contains("Widzę zdjęcie", deltaText);

        var lastTurn = host.ChatProvider.LastTurn;
        Assert.NotNull(lastTurn);
        var forwarded = Assert.Single(lastTurn!.Images!);
        Assert.Equal("image/jpeg", forwarded.MediaType);
        Assert.True(Convert.FromBase64String(forwarded.DataBase64).Length > 0);

        var hist = JsonDocument.Parse(await (await host.SendAsync(HttpMethod.Get, "/api/chat/history", email: AdminEmail))
            .Content.ReadAsStringAsync()).RootElement;
        Assert.Contains("📷 paragon.png", hist[0].GetProperty("content").GetString()!);
    }

    [Fact]
    public async Task RecipeSharing_TokenFlow_ClonesIndependentlyAcrossHouseholds_AndRevokesCleanly()
    {
        await using var host = await BuildTestAppAsync();

        var created = await host.SendAsync(HttpMethod.Post, "/api/recipes", email: AdminEmail, body: new
        {
            title = "Sernik baskijski",
            source = "manual",
            time = 55,
            servings = 8,
            kcal = 320,
            protein = 12m,
            fat = 22m,
            carbs = 18m,
            tags = new[] { "deser" },
            ingredients = new[] { new { name = "Twaróg", quantity = "500 g", amountValue = 500m, amountUnit = "g" } },
            steps = new[] { "Wymieszaj i piecz 40 min w 220°C." },
        });
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var recipeId = JsonDocument.Parse(await created.Content.ReadAsStringAsync()).RootElement.GetProperty("id").GetGuid();

        // Attach a recipe photo in Household 1
        var imgUpload = await host.SendFileAsync($"/api/recipes/{recipeId}/image", "sernik.png", "image/png", MakeTestPng(), email: AdminEmail);
        Assert.Equal(HttpStatusCode.OK, imgUpload.StatusCode);
        var h1ImageUrl = JsonDocument.Parse(await imgUpload.Content.ReadAsStringAsync()).RootElement.GetProperty("imageUrl").GetString()!;

        // Create share link (idempotent on repeat call)
        var s1 = await host.SendAsync(HttpMethod.Post, $"/api/recipes/{recipeId}/share", email: AdminEmail);
        Assert.Equal(HttpStatusCode.OK, s1.StatusCode);
        var shareDoc = JsonDocument.Parse(await s1.Content.ReadAsStringAsync()).RootElement;
        var token = shareDoc.GetProperty("token").GetString()!;
        Assert.True(shareDoc.GetProperty("active").GetBoolean());

        var s2 = await host.SendAsync(HttpMethod.Post, $"/api/recipes/{recipeId}/share", email: AdminEmail);
        Assert.Equal(token, JsonDocument.Parse(await s2.Content.ReadAsStringAsync()).RootElement.GetProperty("token").GetString());

        // Anonymous GET /api/shared/{token} and its image work, while anonymous POST import is rejected with 401
        var anonGet = await host.SendAsync(HttpMethod.Get, $"/api/shared/{token}");
        Assert.Equal(HttpStatusCode.OK, anonGet.StatusCode);
        var sharedJson = JsonDocument.Parse(await anonGet.Content.ReadAsStringAsync()).RootElement;
        Assert.Equal("Sernik baskijski", sharedJson.GetProperty("title").GetString());
        Assert.Equal("Dom 1", sharedJson.GetProperty("sharedByHousehold").GetString());
        Assert.False(sharedJson.GetProperty("isOwnHousehold").GetBoolean());
        var sharedImgUrl = sharedJson.GetProperty("imageUrl").GetString()!;
        Assert.StartsWith($"/api/shared/{token}/image/", sharedImgUrl);

        var anonImg = await host.SendAsync(HttpMethod.Get, sharedImgUrl);
        Assert.Equal(HttpStatusCode.OK, anonImg.StatusCode);
        Assert.Equal("image/webp", anonImg.Content.Headers.ContentType?.MediaType);

        var anonImport = await host.SendAsync(HttpMethod.Post, $"/api/shared/{token}/import");
        Assert.Equal(HttpStatusCode.Unauthorized, anonImport.StatusCode);

        // Household 2 has "Twaróg" in its pantry → importing clones recipe, copies photo independently, and relinks pantry
        var h2Pantry = await host.SendAsync(HttpMethod.Post, "/api/pantry", email: MemberEmail, body: new
        {
            name = "Twaróg", category = "Fridge", unit = "g", quantity = 500m,
        });
        Assert.Equal(HttpStatusCode.Created, h2Pantry.StatusCode);

        var imported = await host.SendAsync(HttpMethod.Post, $"/api/shared/{token}/import", email: MemberEmail);
        Assert.Equal(HttpStatusCode.Created, imported.StatusCode);
        var copyId = JsonDocument.Parse(await imported.Content.ReadAsStringAsync()).RootElement.GetProperty("id").GetGuid();
        Assert.NotEqual(recipeId, copyId);

        var copyDetail = JsonDocument.Parse(await (await host.SendAsync(HttpMethod.Get, $"/api/recipes/{copyId}", email: MemberEmail))
            .Content.ReadAsStringAsync()).RootElement;
        Assert.Equal("Sernik baskijski", copyDetail.GetProperty("title").GetString());
        Assert.Equal(1, copyDetail.GetProperty("have").GetInt32());
        Assert.Equal(["deser"], copyDetail.GetProperty("tags").EnumerateArray().Select(t => t.GetString()!).ToArray());
        var h2ImageUrl = copyDetail.GetProperty("imageUrl").GetString()!;
        Assert.NotEqual(h1ImageUrl, h2ImageUrl);

        // Revoking immediately cuts off preview, image, and import
        var revoke = await host.SendAsync(HttpMethod.Delete, $"/api/recipes/{recipeId}/share", email: AdminEmail);
        Assert.Equal(HttpStatusCode.NoContent, revoke.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await host.SendAsync(HttpMethod.Get, $"/api/shared/{token}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await host.SendAsync(HttpMethod.Get, sharedImgUrl)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await host.SendAsync(HttpMethod.Post, $"/api/shared/{token}/import", email: MemberEmail)).StatusCode);
    }

    [Fact]
    public async Task AdminDiagnostics_AndHouseholdExportZip_EnforceAuthAndTenantIsolation()
    {
        await using var host = await BuildTestAppAsync();

        // Non-admin blocked from /api/admin/system
        Assert.Equal(HttpStatusCode.Forbidden, (await host.SendAsync(HttpMethod.Get, "/api/admin/system", email: MemberEmail)).StatusCode);

        // Admin reads system diagnostics + triggers enrichment wake
        var sysRes = await host.SendAsync(HttpMethod.Get, "/api/admin/system", email: AdminEmail);
        Assert.Equal(HttpStatusCode.OK, sysRes.StatusCode);
        var sys = JsonDocument.Parse(await sysRes.Content.ReadAsStringAsync()).RootElement;
        Assert.True(sys.GetProperty("dbConnected").GetBoolean());
        Assert.True(sys.GetProperty("counts").GetProperty("exercises").GetInt32() >= 2);

        var wake = await host.SendAsync(HttpMethod.Post, "/api/admin/enrichment/wake", email: AdminEmail);
        Assert.Equal(HttpStatusCode.OK, wake.StatusCode);

        // Seed distinct recipes in Household 1 & Household 2 (plus a photo in Household 1)
        var r1 = await host.SendAsync(HttpMethod.Post, "/api/recipes", email: AdminEmail, body: new
        {
            title = "Pierogi Domu 1", source = "manual", time = 30, servings = 2,
            ingredients = new[] { new { name = "Mąka", quantity = "300 g" } }, steps = new[] { "Ulep pierogi." },
        });
        var r1Id = JsonDocument.Parse(await r1.Content.ReadAsStringAsync()).RootElement.GetProperty("id").GetGuid();
        Assert.Equal(HttpStatusCode.OK, (await host.SendFileAsync($"/api/recipes/{r1Id}/image", "pierogi.png", "image/png", MakeTestPng(), email: AdminEmail)).StatusCode);

        Assert.Equal(HttpStatusCode.Created, (await host.SendAsync(HttpMethod.Post, "/api/recipes", email: MemberEmail, body: new
        {
            title = "Bigos Domu 2", source = "manual", time = 60, servings = 4,
            ingredients = new[] { new { name = "Kapusta", quantity = "500 g" } }, steps = new[] { "Duś kapustę." },
        })).StatusCode);

        // System/Sous tokens are forbidden from downloading household ZIP backup
        Assert.Equal(HttpStatusCode.Forbidden,
            (await host.SendAsync(HttpMethod.Get, "/api/household/export.zip", apiKey: "test-system-secret", xPerson: "1")).StatusCode);

        // Household 1 member downloads ZIP containing ONLY Household 1's data and photo
        var zipRes = await host.SendAsync(HttpMethod.Get, "/api/household/export.zip", email: AdminEmail);
        Assert.Equal(HttpStatusCode.OK, zipRes.StatusCode);
        Assert.Equal("application/zip", zipRes.Content.Headers.ContentType?.MediaType);

        await using var zipStream = await zipRes.Content.ReadAsStreamAsync();
        using var zip = new ZipArchive(zipStream, ZipArchiveMode.Read);
        var entryNames = zip.Entries.Select(e => e.FullName).ToHashSet(StringComparer.OrdinalIgnoreCase);
        Assert.Contains("README.txt", entryNames);
        Assert.Contains("cookbook.md", entryNames);
        Assert.Contains("recipes.json", entryNames);
        Assert.Contains("pantry.json", entryNames);
        Assert.Contains("recipes/pierogi-domu-1.md", entryNames);
        Assert.Contains(entryNames, n => n.StartsWith("images/", StringComparison.OrdinalIgnoreCase));

        using var reader = new StreamReader(zip.GetEntry("recipes.json")!.Open(), Encoding.UTF8);
        var recipesJson = await reader.ReadToEndAsync();
        Assert.Contains("Pierogi Domu 1", recipesJson);
        Assert.DoesNotContain("Bigos Domu 2", recipesJson);
    }

    private static byte[] MakeTestPng()
    {
        using var bmp = new SKBitmap(16, 16);
        bmp.Erase(SKColors.Coral);
        using var img = SKImage.FromBitmap(bmp);
        using var data = img.Encode(SKEncodedImageFormat.Png, 100);
        return data.ToArray();
    }

    [Fact]
    public async Task TrainingSessions_Lifecycle_Prs_Prefill_TargetUpdate_Isolation_And_Delete()
    {
        await using var host = await BuildTestAppAsync();
        var today = DateOnly.FromDateTime(DateTime.Today);
        var monday = today.AddDays(-((int)today.DayOfWeek + 6) % 7);

        // 1. Create a 2-week program with Barbell Squat + Plank on Monday of week 1 and week 2.
        var createProg = await host.SendAsync(HttpMethod.Post, "/api/training/programs", email: AdminEmail, body: new
        {
            name = "Siła testowa",
            startDate = monday.ToString("yyyy-MM-dd"),
            weeks = 2,
            activate = true,
            days = new object[]
            {
                new
                {
                    week = 1, weekday = 0, name = "Dół A", kind = "exercises",
                    exercises = new object[]
                    {
                        new { exerciseId = host.SharedExerciseId, sets = 2, repsMin = 8, repsMax = 10, restSeconds = 90, targetKg = 50m },
                        new { exerciseId = host.TimedExerciseId, sets = 1, seconds = 30, restSeconds = 45 },
                    },
                },
                new
                {
                    week = 2, weekday = 0, name = "Dół A", kind = "exercises",
                    exercises = new object[]
                    {
                        new { exerciseId = host.SharedExerciseId, sets = 2, repsMin = 8, repsMax = 10, restSeconds = 90, targetKg = 52.5m },
                        new { exerciseId = host.TimedExerciseId, sets = 1, seconds = 35, restSeconds = 45 },
                    },
                },
            },
        });
        Assert.Equal(HttpStatusCode.Created, createProg.StatusCode);
        using var progJson = JsonDocument.Parse(await createProg.Content.ReadAsStringAsync());
        var week1DayId = progJson.RootElement.GetProperty("days")[0].GetProperty("id").GetGuid();
        var week2DayId = progJson.RootElement.GetProperty("days")[1].GetProperty("id").GetGuid();

        // 2. Start live session #1 from Week 1 Day 1.
        var start1 = await host.SendAsync(HttpMethod.Post, "/api/training/sessions", email: AdminEmail,
            body: new { programDayId = week1DayId, date = today.ToString("yyyy-MM-dd") });
        Assert.Equal(HttpStatusCode.Created, start1.StatusCode);
        using var s1 = JsonDocument.Parse(await start1.Content.ReadAsStringAsync());
        var s1Id = s1.RootElement.GetProperty("id").GetGuid();
        Assert.Equal(2, s1.RootElement.GetProperty("exercises").GetArrayLength());

        // Single-active-session guard returns 409 with activeSessionId.
        var duplicateStart = await host.SendAsync(HttpMethod.Post, "/api/training/sessions", email: AdminEmail,
            body: new { name = "Drugi naraz" });
        Assert.Equal(HttpStatusCode.Conflict, duplicateStart.StatusCode);
        using var dupJson = JsonDocument.Parse(await duplicateStart.Content.ReadAsStringAsync());
        Assert.Equal(s1Id, dupJson.RootElement.GetProperty("activeSessionId").GetGuid());

        // Cross-person (ActivePartner in same household) & cross-household (Member in household 2) isolation.
        var partnerRead = await host.SendAsync(HttpMethod.Get, $"/api/training/sessions/{s1Id}", email: "partner@example.com");
        Assert.Equal(HttpStatusCode.NotFound, partnerRead.StatusCode);
        var otherHouseRead = await host.SendAsync(HttpMethod.Get, $"/api/training/sessions/{s1Id}", email: MemberEmail);
        Assert.Equal(HttpStatusCode.NotFound, otherHouseRead.StatusCode);

        // Log sets: Squat 60 kg × 8 (2 sets) and Plank 45 s.
        var s1SquatSets = s1.RootElement.GetProperty("exercises")[0].GetProperty("sets");
        var s1PlankSetId = s1.RootElement.GetProperty("exercises")[1].GetProperty("sets")[0].GetProperty("id").GetGuid();
        foreach (var setEl in s1SquatSets.EnumerateArray())
        {
            var setId = setEl.GetProperty("id").GetGuid();
            var p = await host.SendAsync(HttpMethod.Patch, $"/api/training/sessions/{s1Id}/sets/{setId}",
                email: AdminEmail, body: new { weightKg = 60m, reps = 8, completed = true });
            Assert.Equal(HttpStatusCode.OK, p.StatusCode);
        }
        var pPlank1 = await host.SendAsync(HttpMethod.Patch, $"/api/training/sessions/{s1Id}/sets/{s1PlankSetId}",
            email: AdminEmail, body: new { seconds = 45, completed = true });
        Assert.Equal(HttpStatusCode.OK, pPlank1.StatusCode);

        // Finish session #1 with updateFutureTargets = true → first session sets baseline (0 noisy newPrs), propagates 60 kg to Week 2, links Activity workout.
        var fin1 = await host.SendAsync(HttpMethod.Post, $"/api/training/sessions/{s1Id}/finish",
            email: AdminEmail, body: new { durationMinutes = 40, estimatedKcal = 180, updateFutureTargets = true, logActivity = true });
        Assert.Equal(HttpStatusCode.OK, fin1.StatusCode);
        using var f1 = JsonDocument.Parse(await fin1.Content.ReadAsStringAsync());
        Assert.Equal(0, f1.RootElement.GetProperty("newPrs").GetArrayLength());
        Assert.Equal(960m, f1.RootElement.GetProperty("totalVolumeKg").GetDecimal());
        Assert.Equal(1, f1.RootElement.GetProperty("updatedFutureTargets").GetInt32());
        Assert.True(f1.RootElement.GetProperty("activityLinked").GetBoolean());

        // Verify program now marks Week 1 Day 1 completed and Week 2 Squat target updated to 60 kg.
        var progAfter = await host.SendAsync(HttpMethod.Get, "/api/training/program", email: AdminEmail);
        Assert.Equal(HttpStatusCode.OK, progAfter.StatusCode);
        using var pa = JsonDocument.Parse(await progAfter.Content.ReadAsStringAsync());
        Assert.Equal(s1Id, pa.RootElement.GetProperty("days")[0].GetProperty("completedSessionId").GetGuid());
        Assert.Equal(60m, pa.RootElement.GetProperty("days")[1].GetProperty("exercises")[0].GetProperty("targetKg").GetDecimal());

        // 3. Start session #2 from Week 2 Day 1 → pre-fills previous performance (60 kg × 8, 45 s) & returns PR baseline.
        var start2 = await host.SendAsync(HttpMethod.Post, "/api/training/sessions", email: AdminEmail,
            body: new { programDayId = week2DayId, date = today.ToString("yyyy-MM-dd") });
        Assert.Equal(HttpStatusCode.Created, start2.StatusCode);
        using var s2 = JsonDocument.Parse(await start2.Content.ReadAsStringAsync());
        var s2Id = s2.RootElement.GetProperty("id").GetGuid();
        var s2Squat = s2.RootElement.GetProperty("exercises")[0];
        Assert.Equal(60m, s2Squat.GetProperty("sets")[0].GetProperty("weightKg").GetDecimal());
        Assert.Equal(8, s2Squat.GetProperty("sets")[0].GetProperty("reps").GetInt32());
        Assert.Equal(60m, s2Squat.GetProperty("prBaseline").GetProperty("bestWeightKg").GetDecimal());
        Assert.Equal(45, s2.RootElement.GetProperty("exercises")[1].GetProperty("sets")[0].GetProperty("seconds").GetInt32());

        // Beat both PRs: Squat 65 kg × 8 and Plank 60 s.
        var s2SquatSet1 = s2Squat.GetProperty("sets")[0].GetProperty("id").GetGuid();
        var s2PlankSet1 = s2.RootElement.GetProperty("exercises")[1].GetProperty("sets")[0].GetProperty("id").GetGuid();
        Assert.Equal(HttpStatusCode.OK, (await host.SendAsync(HttpMethod.Patch, $"/api/training/sessions/{s2Id}/sets/{s2SquatSet1}",
            email: AdminEmail, body: new { weightKg = 65m, reps = 8, completed = true })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await host.SendAsync(HttpMethod.Patch, $"/api/training/sessions/{s2Id}/sets/{s2PlankSet1}",
            email: AdminEmail, body: new { seconds = 60, completed = true })).StatusCode);

        var fin2 = await host.SendAsync(HttpMethod.Post, $"/api/training/sessions/{s2Id}/finish",
            email: AdminEmail, body: new { durationMinutes = 42, estimatedKcal = 190, logActivity = true });
        Assert.Equal(HttpStatusCode.OK, fin2.StatusCode);
        using var f2 = JsonDocument.Parse(await fin2.Content.ReadAsStringAsync());
        var newPrs2 = f2.RootElement.GetProperty("newPrs").EnumerateArray().ToList();
        Assert.Equal(2, newPrs2.Count);
        Assert.Contains(newPrs2, x => x.GetProperty("metric").GetString() == "weight" && x.GetProperty("newValue").GetDecimal() == 65m);
        Assert.Contains(newPrs2, x => x.GetProperty("metric").GetString() == "seconds" && x.GetProperty("newValue").GetDecimal() == 60m);

        // 4. Session #3 (ad-hoc): same weight 65 kg but 10 reps → triggers est-1rm PR!
        var start3 = await host.SendAsync(HttpMethod.Post, "/api/training/sessions", email: AdminEmail,
            body: new { name = "Szybkie przysiady", date = today.ToString("yyyy-MM-dd"), exerciseIds = new[] { host.SharedExerciseId } });
        Assert.Equal(HttpStatusCode.Created, start3.StatusCode);
        using var s3 = JsonDocument.Parse(await start3.Content.ReadAsStringAsync());
        var s3Id = s3.RootElement.GetProperty("id").GetGuid();
        var s3Set1 = s3.RootElement.GetProperty("exercises")[0].GetProperty("sets")[0].GetProperty("id").GetGuid();
        Assert.Equal(HttpStatusCode.OK, (await host.SendAsync(HttpMethod.Patch, $"/api/training/sessions/{s3Id}/sets/{s3Set1}",
            email: AdminEmail, body: new { weightKg = 65m, reps = 10, completed = true })).StatusCode);

        // Also test adding and deleting an extra set.
        var addSetRes = await host.SendAsync(HttpMethod.Post, $"/api/training/sessions/{s3Id}/sets",
            email: AdminEmail, body: new { exerciseId = host.SharedExerciseId, exerciseOrder = 0 });
        Assert.Equal(HttpStatusCode.Created, addSetRes.StatusCode);
        using var addSetJson = JsonDocument.Parse(await addSetRes.Content.ReadAsStringAsync());
        var setsAfterAdd = addSetJson.RootElement.GetProperty("exercises")[0].GetProperty("sets");
        var lastAddedId = setsAfterAdd[setsAfterAdd.GetArrayLength() - 1].GetProperty("id").GetGuid();
        Assert.Equal(HttpStatusCode.OK, (await host.SendAsync(HttpMethod.Delete, $"/api/training/sessions/{s3Id}/sets/{lastAddedId}", email: AdminEmail)).StatusCode);

        var fin3 = await host.SendAsync(HttpMethod.Post, $"/api/training/sessions/{s3Id}/finish",
            email: AdminEmail, body: new { durationMinutes = 20, estimatedKcal = 90, logActivity = true });
        Assert.Equal(HttpStatusCode.OK, fin3.StatusCode);
        using var f3 = JsonDocument.Parse(await fin3.Content.ReadAsStringAsync());
        var newPrs3 = f3.RootElement.GetProperty("newPrs").EnumerateArray().ToList();
        Assert.Single(newPrs3);
        Assert.Equal("est-1rm", newPrs3[0].GetProperty("metric").GetString());

        // Check PR leaderboard for Admin vs empty for ActivePartner.
        var prsRes = await host.SendAsync(HttpMethod.Get, "/api/training/prs", email: AdminEmail);
        Assert.Equal(HttpStatusCode.OK, prsRes.StatusCode);
        using var prsJson = JsonDocument.Parse(await prsRes.Content.ReadAsStringAsync());
        Assert.Equal(2, prsJson.RootElement.GetArrayLength());

        var partnerPrs = await host.SendAsync(HttpMethod.Get, "/api/training/prs", email: "partner@example.com");
        Assert.Equal(HttpStatusCode.OK, partnerPrs.StatusCode);
        using var partnerPrsJson = JsonDocument.Parse(await partnerPrs.Content.ReadAsStringAsync());
        Assert.Equal(0, partnerPrsJson.RootElement.GetArrayLength());

        // Check household export ZIP includes trainingSessions in training.json.
        var zipRes = await host.SendAsync(HttpMethod.Get, "/api/household/export.zip", email: AdminEmail);
        Assert.Equal(HttpStatusCode.OK, zipRes.StatusCode);
        using (var zip = new ZipArchive(await zipRes.Content.ReadAsStreamAsync(), ZipArchiveMode.Read))
        {
            var trEntry = zip.GetEntry("training.json");
            Assert.NotNull(trEntry);
            using var reader = new StreamReader(trEntry!.Open());
            var trText = await reader.ReadToEndAsync();
            Assert.Contains("\"sessions\"", trText);
            Assert.Contains("Szybkie przysiady", trText);
        }

        // Delete session #3 → removes both session and its linked MeasurementSource.Training Workout.
        var linkedWorkoutId = f3.RootElement.GetProperty("session").GetProperty("workoutId").GetGuid();
        Assert.Equal(HttpStatusCode.NoContent, (await host.SendAsync(HttpMethod.Delete, $"/api/training/sessions/{s3Id}", email: AdminEmail)).StatusCode);
        using (var scope = host.App.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<MiseDbContext>();
            db.Tenant.UseSystem();
            Assert.Null(await db.Workouts.FirstOrDefaultAsync(w => w.Id == linkedWorkoutId));
        }
    }

    [Fact]
    public async Task ActivityService_AutoDedupes_TrackerWorkouts_Against_Watch_And_BandSamples()
    {
        await using var db = NewInMemoryDb();
        db.Tenant.UseSystem();
        db.Households.Add(new Household { Id = 1, Name = "Dom" });
        db.People.Add(new Person { Id = 1, HouseholdId = 1, Name = "Ania" });
        await db.SaveChangesAsync();

        db.Tenant.UseHousehold(1);
        var person = new PersonScope(1);
        var svc = new ActivityService(db, person);

        var d1 = new DateOnly(2026, 11, 10); // Standalone tracker only → counts kcal
        var d2 = new DateOnly(2026, 11, 11); // Tracker + overlapping Strava → hidden & 0 double-count
        var d3 = new DateOnly(2026, 11, 12); // Tracker + band Active samples in window → shows band kcal, 0 extra kcal
        var d4 = new DateOnly(2026, 11, 13); // Morning Strava + evening Tracker (6h apart) → both count!

        var t1 = new DateTimeOffset(2026, 11, 10, 17, 0, 0, TimeSpan.Zero);
        var t2 = new DateTimeOffset(2026, 11, 11, 17, 0, 0, TimeSpan.Zero);
        var t3 = new DateTimeOffset(2026, 11, 12, 17, 0, 0, TimeSpan.Zero);
        var t4Morning = new DateTimeOffset(2026, 11, 13, 8, 0, 0, TimeSpan.Zero);
        var t4Evening = new DateTimeOffset(2026, 11, 13, 18, 0, 0, TimeSpan.Zero);

        db.Workouts.AddRange(
            // Day 1: tracker only
            new Workout { PersonId = 1, Date = d1, StartedAt = t1, Minutes = 45, Kcal = 200, Type = "Dół A", Source = MeasurementSource.Training, ExternalKey = "training:1" },
            // Day 2: tracker + overlapping Strava (starts 10 min later)
            new Workout { PersonId = 1, Date = d2, StartedAt = t2, Minutes = 50, Kcal = 225, Type = "Góra A", Source = MeasurementSource.Training, ExternalKey = "training:2" },
            new Workout { PersonId = 1, Date = d2, StartedAt = t2.AddMinutes(10), Minutes = 48, Kcal = 310, Type = "Trening siłowy", Source = MeasurementSource.Strava, ExternalKey = "strava:2" },
            // Day 3: tracker + band Active energy samples inside its window
            new Workout { PersonId = 1, Date = d3, StartedAt = t3, Minutes = 40, Kcal = 180, Type = "FBW", Source = MeasurementSource.Training, ExternalKey = "training:3" },
            // Day 4: morning Strava run + evening Pichci strength (separate sessions)
            new Workout { PersonId = 1, Date = d4, StartedAt = t4Morning, Minutes = 35, Kcal = 350, Type = "Bieganie", Source = MeasurementSource.Strava, ExternalKey = "strava:4" },
            new Workout { PersonId = 1, Date = d4, StartedAt = t4Evening, Minutes = 45, Kcal = 200, Type = "Siłowy", Source = MeasurementSource.Training, ExternalKey = "training:4" }
        );
        db.EnergySamples.Add(new EnergySample
        {
            PersonId = 1, Kind = EnergyKind.Active, Date = d3,
            Start = t3.AddMinutes(5), End = t3.AddMinutes(35), Kcal = 240m,
        });
        await db.SaveChangesAsync();

        var days = (await svc.DaysAsync(d1, d4, bmr: 1500)).ToDictionary(x => x.Date);

        // Day 1: tracker shows and adds 200 kcal
        Assert.Equal(200, days[d1].ActiveKcal);
        Assert.Single(days[d1].Workouts);
        Assert.Equal(MeasurementSource.Training, days[d1].Workouts[0].Workout.Source);

        // Day 2: overlapping Strava wins — tracker copy hidden, ActiveKcal == 310 (not 535!)
        Assert.Equal(310, days[d2].ActiveKcal);
        Assert.Single(days[d2].Workouts);
        Assert.Equal(MeasurementSource.Strava, days[d2].Workouts[0].Workout.Source);

        // Day 3: band Active samples (240) win — tracker stays visible displaying band's 240 kcal, 0 extra kcal added!
        Assert.Equal(240, days[d3].ActiveKcal);
        Assert.Single(days[d3].Workouts);
        Assert.Equal(240, days[d3].Workouts[0].Kcal);

        // Day 4: separate sessions — both visible, both contribute (350 + 200 = 550)
        Assert.Equal(550, days[d4].ActiveKcal);
        Assert.Equal(2, days[d4].Workouts.Count);
    }

    // ---- Test host harness ----

    private static MiseDbContext NewInMemoryDb() =>
        new(new DbContextOptionsBuilder<MiseDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);

    private sealed class RecordingChatProvider : IChatProvider
    {
        public bool Enabled => true;
        public string Name => "test";
        public bool NeedsSystemPrompt => false;
        public ChatTurnRequest? LastTurn { get; private set; }

        public async IAsyncEnumerable<ChatChunk> StreamAsync(ChatTurnRequest turn, [EnumeratorCancellation] CancellationToken ct)
        {
            LastTurn = turn;
            await Task.Yield();
            yield return new ChatChunk(Delta: turn.Images is { Count: > 0 } ? "Widzę zdjęcie." : "OK");
        }
    }

    private sealed class TestHostApp(WebApplication app, Guid sharedExerciseId, Guid timedExerciseId,
        RecordingChatProvider chatProvider) : IAsyncDisposable
    {
        public WebApplication App { get; } = app;
        public Guid SharedExerciseId { get; } = sharedExerciseId;
        public Guid TimedExerciseId { get; } = timedExerciseId;
        public RecordingChatProvider ChatProvider { get; } = chatProvider;

        public async Task<HttpResponseMessage> SendAsync(HttpMethod method, string path,
            string? email = null, string? apiKey = null, string? xPerson = null, object? body = null)
        {
            using var client = App.GetTestClient();
            using var req = new HttpRequestMessage(method, path);
            if (email is not null) req.Headers.Add("X-Test-Email", email);
            if (apiKey is not null) req.Headers.Add(AccessControl.ApiKeyHeader, apiKey);
            if (xPerson is not null) req.Headers.Add(People.Header, xPerson);
            if (body is not null) req.Content = JsonContent.Create(body);
            return await client.SendAsync(req);
        }

        public async Task<HttpResponseMessage> SendFileAsync(string path, string fileName, string contentType,
            byte[] bytes, string? email = null)
        {
            using var client = App.GetTestClient();
            using var req = new HttpRequestMessage(HttpMethod.Post, path);
            if (email is not null) req.Headers.Add("X-Test-Email", email);
            var form = new MultipartFormDataContent();
            var content = new ByteArrayContent(bytes);
            content.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue(contentType);
            form.Add(content, "file", fileName);
            req.Content = form;
            return await client.SendAsync(req);
        }

        public ValueTask DisposeAsync() => App.DisposeAsync();
    }

    private static async Task<TestHostApp> BuildTestAppAsync(Action<WebApplicationBuilder>? configure = null)
    {
        var dbName = Guid.NewGuid().ToString();
        var ctxDir = Path.Combine(Path.GetTempPath(), "pichci-audit-ctx-" + Guid.NewGuid());
        var imgDir = Path.Combine(Path.GetTempPath(), "pichci-audit-img-" + Guid.NewGuid());
        Directory.CreateDirectory(ctxDir);
        Directory.CreateDirectory(imgDir);

        var chatProvider = new RecordingChatProvider();
        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseTestServer();
        builder.Configuration["MISE_API_KEY"] = "test-system-secret";
        builder.Configuration["Auth:AdminEmails"] = AdminEmail;
        builder.Configuration["Auth:PublicHouseholdId"] = "1";
        builder.Configuration["ContextDir"] = ctxDir;
        builder.Configuration["ImagesDir"] = imgDir;

        builder.Services.AddDataProtection();
        builder.Services.AddMemoryCache();
        builder.Services.AddDbContext<MiseDbContext>(o => o.UseInMemoryDatabase(dbName)
            .ConfigureWarnings(w => w.Ignore(Microsoft.EntityFrameworkCore.Diagnostics.InMemoryEventId.TransactionIgnoredWarning)));
        builder.Services.AddSingleton<AccessControl>();
        builder.Services.AddHttpContextAccessor();
        builder.Services.AddTenancy();
        builder.Services.AddHouseholdRateLimits();
        builder.Services.AddScoped<IngredientMatcher>();
        builder.Services.AddScoped<RecipeIngredientNormalizer>();
        builder.Services.AddScoped<ShoppingService>();
        builder.Services.AddScoped<SupplyService>();
        builder.Services.AddScoped<DiaryService>();
        builder.Services.AddScoped<MealSlots>();
        builder.Services.AddScoped<BodyService>();
        builder.Services.AddScoped<ActivityService>();
        builder.Services.AddSingleton(StravaOptions.From(builder.Configuration));
        builder.Services.AddSingleton<StravaEventQueue>();
        builder.Services.AddHttpClient<StravaClient>();
        builder.Services.AddScoped<StravaService>();
        builder.Services.AddScoped<CateringService>();
        builder.Services.AddScoped<OpenFoodFacts>();
        builder.Services.AddScoped<StockReliability>();
        builder.Services.AddScoped<HouseholdProvisioner>();
        builder.Services.AddSingleton<CookbookMarkdownBuilder>();
        builder.Services.AddSingleton<RecipeImageStore>();
        builder.Services.AddSingleton<ChatImageStore>();
        builder.Services.AddSingleton<IChatProvider>(chatProvider);
        builder.Services.AddSingleton<ContextExportQueue>();
        builder.Services.AddScoped<ContextExportService>();
        builder.Services.AddScoped<HouseholdExportService>();
        builder.Services.AddScoped<ImportService>();
        builder.Services.AddSingleton<YouTubeVerifier>();
        builder.Services.AddSingleton<EnrichmentState>();
        builder.Services.AddSingleton<ISousJobs, SousJobs>();
        builder.Services.AddScoped<ExerciseEnrichment>();
        builder.Services.AddScoped<RecipeNutritionEstimator>();
        builder.Services.AddSingleton<ExerciseImages>();
        builder.Services.AddSingleton<SafeWebFetcher>();
        builder.Services.AddHttpClient();
        builder.Services.AddEndpointsApiExplorer();
        builder.Services.AddSwaggerGen(c =>
            c.SwaggerDoc("v1", new() { Title = "Pichci API", Version = "v1" }));
        builder.Services.AddAuthentication("Test")
            .AddScheme<AuthenticationSchemeOptions, HeaderAuthHandler>("Test", _ => { });
        builder.Services.AddAuthorization();

        configure?.Invoke(builder);
        var app = builder.Build();
        app.UseAuthentication();
        app.UseMiddleware<ApiAccessMiddleware>();
        app.UseRateLimiter();
        app.UseSwagger(c => c.RouteTemplate = "api/swagger/{documentName}/swagger.json");
        var api = app.MapGroup("/api");
        api.MapImages();
        api.MapAuth();
        api.MapHouseholds();
        api.MapAdmin();
        api.MapKeys();
        api.MapRecipes();
        api.MapSharedRecipes();
        api.MapPantry();
        api.MapShopping();
        api.MapSupplies();
        api.MapPreferences();
        api.MapProfileQuestionnaire();
        api.MapContext();
        api.MapCookLog();
        api.MapPlan();
        api.MapDiary();
        api.MapMeals();
        api.MapBody();
        api.MapActivity();
        api.MapExercises();
        api.MapTraining();
        api.MapChat();
        api.MapImport();
        await app.StartAsync();

        Guid sharedExId, timedExId;
        using (var scope = app.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<MiseDbContext>();
            db.Tenant.UseSystem();
            db.Households.AddRange(
                new Household { Id = 1, Name = "Dom 1" },
                new Household { Id = 2, Name = "Dom 2" });
            db.People.AddRange(
                new Person { Id = 1, HouseholdId = 1, Name = "Admin", Email = AdminEmail, Role = HouseholdRole.Owner, IsAdmin = true },
                new Person { Id = 2, HouseholdId = 1, Name = "BlockedPartner", Email = BlockedPartnerEmail, Role = HouseholdRole.Member, BlockedAt = DateTimeOffset.UtcNow },
                new Person { Id = 3, HouseholdId = 2, Name = "Member", Email = MemberEmail, Role = HouseholdRole.Owner },
                new Person { Id = 4, HouseholdId = 1, Name = "ActivePartner", Email = "partner@example.com", Role = HouseholdRole.Member });
            var shared = new Exercise { SourceId = "Barbell_Squat", NameEn = "Barbell Squat", PrimaryMuscles = ["Quadriceps"], IsTimed = false };
            var timed = new Exercise { SourceId = "Plank", NameEn = "Plank", PrimaryMuscles = ["Abdominals"], IsTimed = true };
            db.Exercises.AddRange(shared, timed);
            await db.SaveChangesAsync();
            sharedExId = shared.Id;
            timedExId = timed.Id;
        }

        return new TestHostApp(app, sharedExId, timedExId, chatProvider);
    }

    private sealed class HeaderAuthHandler(IOptionsMonitor<AuthenticationSchemeOptions> options, ILoggerFactory logger,
        System.Text.Encodings.Web.UrlEncoder encoder)
        : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
    {
        protected override Task<AuthenticateResult> HandleAuthenticateAsync()
        {
            if (!Request.Headers.TryGetValue("X-Test-Email", out var email) || string.IsNullOrWhiteSpace(email))
                return Task.FromResult(AuthenticateResult.NoResult());
            var claims = new[] { new Claim(ClaimTypes.Email, email.ToString()), new Claim(ClaimTypes.Name, "Test") };
            var principal = new ClaimsPrincipal(new ClaimsIdentity(claims, "Test"));
            return Task.FromResult(AuthenticateResult.Success(new AuthenticationTicket(principal, "Test")));
        }
    }

    private sealed class StubHttpHandler : HttpMessageHandler
    {
        public readonly Dictionary<string, (HttpStatusCode Status, string Json)> Map = [];
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            var key = $"{request.Method} {request.RequestUri!.AbsolutePath}";
            var (status, json) = Map.TryGetValue(key, out var r) ? r : (HttpStatusCode.NotFound, "{}");
            return Task.FromResult(new HttpResponseMessage(status) { Content = new StringContent(json, Encoding.UTF8, "application/json") });
        }
    }
}
