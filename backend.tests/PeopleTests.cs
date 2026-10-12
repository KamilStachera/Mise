using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Mise.Api.Data;
using Mise.Api.Domain;
using Mise.Api.Services;
using Xunit;

namespace Mise.Api.Tests;

/// <summary>Two diaries in one household: person scoping, the shared scale, catering.</summary>
public class PeopleTests
{
    private static readonly PersonScope Her = new(1), Him = new(2);

    private const string Payload = """
        {
          "active_calories": [{ "calories": 200, "start_time": "2026-10-13T10:00:00Z", "end_time": "2026-10-13T10:45:00Z" }],
          "exercise": [{ "type": "WALKING", "start_time": "2026-10-13T10:00:00Z", "end_time": "2026-10-13T10:45:00Z" }],
          "weight": [{ "kilograms": 71.4, "time": "2026-10-13T07:05:00Z" }]
        }
        """;

    private static readonly DateOnly Day = DateOnly.FromDateTime(new DateTimeOffset(2026, 10, 13, 10, 0, 0, TimeSpan.Zero).LocalDateTime);

    [Fact]
    public async Task SamePayloadOnTwoPhones_LandsInTwoSeparateLogs()
    {
        await using var db = NewDb();
        var hers = new ActivityService(db, Her);
        var his = new ActivityService(db, Him);
        var herToken = (await hers.SyncAsync()).Token;
        var hisToken = (await his.SyncAsync()).Token;
        var payload = JsonSerializer.Deserialize<HcPayload>(Payload)!;

        var hisSync = await his.AuthorizeAsync(hisToken);
        Assert.Equal(2, hisSync!.PersonId);
        Assert.Equal(1, (await hers.AuthorizeAsync(herToken))!.PersonId);
        await hers.IngestAsync((await hers.AuthorizeAsync(herToken))!, payload);
        await his.IngestAsync(hisSync, payload);

        Assert.Equal(2, await db.EnergySamples.CountAsync());
        Assert.Equal(2, await db.Workouts.CountAsync());
        Assert.Equal(200, (await his.DaysAsync(Day, Day, null)).Single().ActiveKcal);
        Assert.Equal(200, (await hers.DaysAsync(Day, Day, null)).Single().ActiveKcal);
        Assert.Equal(71.4m, (await new BodyService(db, Him).LatestWeightAsync())!.Kg);
        Assert.Equal(2, await db.WeightEntries.CountAsync());
    }

    [Fact]
    public async Task ManualWeighIn_StaysWithItsOwner()
    {
        await using var db = NewDb();
        await new BodyService(db, Him).SetWeightAsync(Day, 92.3m, MeasurementSource.Manual);

        Assert.Null(await new BodyService(db, Her).LatestWeightAsync());
        Assert.Equal(92.3m, (await new BodyService(db, Him).LatestWeightAsync())!.Kg);
    }

    [Fact]
    public async Task SharedScale_ReadingFarFromRecentWeighIns_IsDropped()
    {
        await using var db = NewDb();
        db.WeightEntries.Add(new WeightEntry { PersonId = 2, Date = Day.AddDays(-2), Kg = 92m });
        await db.SaveChangesAsync();
        var his = new ActivityService(db, Him);

        var r = await his.IngestAsync(await his.SyncAsync(), JsonSerializer.Deserialize<HcPayload>(Payload)!);

        Assert.Equal((0, 1), (r.Weights, r.WeightsIgnored));
        Assert.Equal(1, await db.WeightEntries.CountAsync());
    }

    [Fact]
    public async Task Catering_WritesDeliveryDaysOnce_AndNeverRewritesThePast()
    {
        await using var db = NewDb();
        var catering = new CateringService(db, Him);
        var monday = new DateOnly(2026, 10, 5);
        var sunday = monday.AddDays(6);

        await catering.SaveAsync(true, 1996, 145, 77, 180, 0b0011111, monday, sunday);
        await catering.EnsureAsync(sunday);

        var week = await db.PlanEntries.Where(e => e.IsCatering).OrderBy(e => e.Date).ToListAsync();
        Assert.Equal(5, week.Count);   // Mon–Fri only
        Assert.All(week, e => Assert.Equal((2, 1996, true), (e.PersonId, e.Kcal!.Value, e.EatenAt is not null)));
        Assert.Equal(monday.AddDays(4), week[^1].Date);

        // "Dziś bez cateringu" on Wednesday, then new numbers from next week.
        db.PlanEntries.Remove(week[2]);
        await db.SaveChangesAsync();
        await catering.SaveAsync(true, 2100, 150, 80, 190, 0b0011111, monday, sunday);
        await catering.EnsureAsync(sunday.AddDays(2));

        var all = await db.PlanEntries.Where(e => e.IsCatering).OrderBy(e => e.Date).ToListAsync();
        Assert.Equal(6, all.Count);
        Assert.DoesNotContain(all, e => e.Date == monday.AddDays(2));
        Assert.Equal(1996, all[0].Kcal);
        Assert.Equal([2100, 2100], all.Where(e => e.Date > sunday).Select(e => e.Kcal!.Value));
        Assert.Equal(0, await db.PlanEntries.CountAsync(e => e.PersonId == 1));
    }

    [Fact]
    public async Task Catering_CountsInIntake()
    {
        await using var db = NewDb();
        var monday = new DateOnly(2026, 10, 5);
        await new CateringService(db, Him).SaveAsync(true, 1996, null, null, null, 0b0011111, monday, monday);
        await new DiaryService(db, Him).AddEntryAsync(monday, MealSlot.Snack, null, "Baton", null, null, null,
            250, null, null, null, eaten: true);

        var day = (await new BodyService(db, Him).IntakeAsync(monday, monday, 2200, 50, new Dictionary<DateOnly, int>())).Single();
        var hers = (await new BodyService(db, Her).IntakeAsync(monday, monday, 1650, 50, new Dictionary<DateOnly, int>())).Single();

        Assert.Equal(2246, day.Eaten);
        Assert.False(hers.Logged);
    }

    [Fact]
    public async Task Favourites_ArePerPerson()
    {
        await using var db = NewDb();
        await new DiaryService(db, Her).RememberAsync("Kinder Bueno", 245, null, null, null, false, null, null);
        await new DiaryService(db, Him).RememberAsync("Kinder Bueno", 250, null, null, null, false, null, null);

        Assert.Equal(2, await db.FoodFavorites.CountAsync());
        Assert.Equal(250, Assert.Single(await new DiaryService(db, Him).FavoritesAsync(false, null)).Kcal);
    }

    [Fact]
    public void Resolver_HeaderForPrivilegedOnly_ThenOwnEmail_ThenPersonOne()
    {
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Diary:People"] = "Ania:ania@example.com, Kamil:kamil@example.com",
            ["Auth:AllowedEmails"] = "ania@example.com,kamil@example.com",
            ["MISE_API_KEY"] = "secret",
        }).Build();
        var people = new People(config);
        var access = new AccessControl(config);

        Assert.Equal(["Ania", "Kamil"], people.All.Select(p => p.Name));
        Assert.Equal(1, people.Resolve(Ctx(header: "2"), access).Id);                       // anonymous: header ignored
        Assert.Equal(2, people.Resolve(Ctx(header: "2", apiKey: "secret"), access).Id);     // agent picks
        Assert.Equal(1, people.Resolve(Ctx(apiKey: "secret"), access).Id);                  // agent default
        Assert.Equal(2, people.Resolve(Ctx(email: "KAMIL@example.com"), access).Id);        // own login
        Assert.Equal(1, people.Resolve(Ctx(email: "kamil@example.com", header: "1"), access).Id);
        Assert.Equal(2, people.Resolve(Ctx(email: "kamil@example.com", header: "9"), access).Id);   // unknown id
        Assert.Equal(1, people.Resolve(null, access).Id);
    }

    [Fact]
    public void People_Unset_IsOnePerson()
    {
        var people = new People(new ConfigurationBuilder().Build());
        Assert.Equal(1, Assert.Single(people.All).Id);
    }

    private static HttpContext Ctx(string? header = null, string? apiKey = null, string? email = null)
    {
        var ctx = new DefaultHttpContext();
        if (header is not null) ctx.Request.Headers[People.Header] = header;
        if (apiKey is not null) ctx.Request.Headers[AccessControl.ApiKeyHeader] = apiKey;
        if (email is not null)
            ctx.User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.Email, email)], "test"));
        return ctx;
    }

    private static MiseDbContext NewDb() => new(new DbContextOptionsBuilder<MiseDbContext>()
        .UseInMemoryDatabase(Guid.NewGuid().ToString())
        .Options);
}
