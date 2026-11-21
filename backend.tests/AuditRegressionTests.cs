using System.Net;
using System.Net.Http.Json;
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
using Mise.Api.Services.Import;
using Mise.Api.Services.Strava;
using Mise.Api.Services.Training;
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
    public async Task PersonalKey_IgnoresXPersonHeaderWithinSameHousehold()
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

        // Person 4 is an active partner in Household 1; a personal key for Person 1 must NOT impersonate Person 4.
        var log = await host.SendAsync(HttpMethod.Post, "/api/plan/entries", apiKey: key, xPerson: "4", body: new
        {
            date = "2026-11-20",
            slot = "breakfast",
            title = "Owsianka",
            kcal = 350,
        });
        Assert.True(log.IsSuccessStatusCode, $"Expected 2xx, got {(int)log.StatusCode}: {await log.Content.ReadAsStringAsync()}");

        using (var scope = host.App.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<MiseDbContext>();
            db.Tenant.UseHousehold(1);
            var entry = await db.PlanEntries.SingleAsync();
            Assert.Equal(1, entry.PersonId);
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

    // ---- Test host harness ----

    private static MiseDbContext NewInMemoryDb() =>
        new(new DbContextOptionsBuilder<MiseDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);

    private sealed class TestHostApp(WebApplication app, Guid sharedExerciseId, Guid timedExerciseId) : IAsyncDisposable
    {
        public WebApplication App { get; } = app;
        public Guid SharedExerciseId { get; } = sharedExerciseId;
        public Guid TimedExerciseId { get; } = timedExerciseId;

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

        public ValueTask DisposeAsync() => App.DisposeAsync();
    }

    private static async Task<TestHostApp> BuildTestAppAsync()
    {
        var dbName = Guid.NewGuid().ToString();
        var ctxDir = Path.Combine(Path.GetTempPath(), "pichci-audit-ctx-" + Guid.NewGuid());
        var imgDir = Path.Combine(Path.GetTempPath(), "pichci-audit-img-" + Guid.NewGuid());
        Directory.CreateDirectory(ctxDir);
        Directory.CreateDirectory(imgDir);

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
        builder.Services.AddScoped<BodyService>();
        builder.Services.AddScoped<ActivityService>();
        builder.Services.AddSingleton(StravaOptions.From(builder.Configuration));
        builder.Services.AddHttpClient<StravaClient>();
        builder.Services.AddScoped<StravaService>();
        builder.Services.AddScoped<CateringService>();
        builder.Services.AddScoped<OpenFoodFacts>();
        builder.Services.AddScoped<StockReliability>();
        builder.Services.AddScoped<HouseholdProvisioner>();
        builder.Services.AddSingleton<CookbookMarkdownBuilder>();
        builder.Services.AddSingleton<RecipeImageStore>();
        builder.Services.AddSingleton<ContextExportQueue>();
        builder.Services.AddScoped<ContextExportService>();
        builder.Services.AddSingleton<YouTubeVerifier>();
        builder.Services.AddSingleton<EnrichmentState>();
        builder.Services.AddSingleton<ISousJobs, SousJobs>();
        builder.Services.AddScoped<ExerciseEnrichment>();
        builder.Services.AddSingleton<ExerciseImages>();
        builder.Services.AddSingleton<SafeWebFetcher>();
        builder.Services.AddHttpClient();
        builder.Services.AddEndpointsApiExplorer();
        builder.Services.AddSwaggerGen(c =>
            c.SwaggerDoc("v1", new() { Title = "Pichci API", Version = "v1" }));
        builder.Services.AddAuthentication("Test")
            .AddScheme<AuthenticationSchemeOptions, HeaderAuthHandler>("Test", _ => { });
        builder.Services.AddAuthorization();

        var app = builder.Build();
        app.UseAuthentication();
        app.UseMiddleware<ApiAccessMiddleware>();
        app.UseRateLimiter();
        app.UseSwagger(c => c.RouteTemplate = "api/swagger/{documentName}/swagger.json");
        var api = app.MapGroup("/api");
        api.MapAuth();
        api.MapHouseholds();
        api.MapAdmin();
        api.MapKeys();
        api.MapRecipes();
        api.MapPantry();
        api.MapShopping();
        api.MapSupplies();
        api.MapPreferences();
        api.MapProfileQuestionnaire();
        api.MapContext();
        api.MapCookLog();
        api.MapPlan();
        api.MapDiary();
        api.MapActivity();
        api.MapExercises();
        api.MapTraining();
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

        return new TestHostApp(app, sharedExId, timedExId);
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
