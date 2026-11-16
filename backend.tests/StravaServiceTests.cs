using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Mise.Api.Data;
using Mise.Api.Domain;
using Mise.Api.Services;
using Mise.Api.Services.Strava;
using Xunit;

namespace Mise.Api.Tests;

public class StravaServiceTests
{
    private static readonly StravaOptions Options = new("12345", "s3cret", null);
    private const string FullScope = "read,activity:read_all";

    private static string Token(string access, string refresh, DateTimeOffset expires, bool athlete = true) => JsonSerializer.Serialize(new Dictionary<string, object?>
    {
        ["token_type"] = "Bearer", ["access_token"] = access, ["refresh_token"] = refresh, ["expires_at"] = expires.ToUnixTimeSeconds(),
        ["athlete"] = athlete ? new { id = 777, firstname = "Ania", lastname = "K" } : null,
    });

    private static string Activity(long id, string sport, DateTimeOffset start, int moving, decimal? calories) => JsonSerializer.Serialize(new Dictionary<string, object?>
    {
        ["id"] = id, ["name"] = "Popołudniowy trening", ["sport_type"] = sport, ["type"] = sport,
        ["start_date"] = start.ToString("yyyy-MM-ddTHH:mm:ssZ"), ["elapsed_time"] = moving + 300, ["moving_time"] = moving,
        ["calories"] = calories, ["kilojoules"] = 999,
    });

    // Mid-day UTC so the local day is the same in any time zone the tests run in.
    private static readonly DateTimeOffset Start = new DateTimeOffset(DateTime.UtcNow.Date, TimeSpan.Zero).AddDays(-1).AddHours(10);

    [Fact]
    public async Task Connect_EncryptsTokens_AndImportsTheLastWeekWithTheWatchKcal()
    {
        var (db, strava, http) = Setup();
        http.Map["POST /oauth/token"] = (HttpStatusCode.OK, Token("acc-1", "ref-1", DateTimeOffset.UtcNow.AddHours(6)));
        http.Map["GET /api/v3/athlete/activities"] = (HttpStatusCode.OK, $$"""[{ "id": 11, "start_date": "{{Start:yyyy-MM-ddTHH:mm:ssZ}}" }]""");
        http.Map["GET /api/v3/activities/11"] = (HttpStatusCode.OK, Activity(11, "WeightTraining", Start, 2700, 412.4m));

        Assert.Equal(StravaConnectOutcome.Connected, await strava.ConnectAsync(1, "code", FullScope));

        var conn = await db.StravaConnections.SingleAsync();
        Assert.Equal((777L, "Ania K"), (conn.AthleteId, conn.AthleteName));
        Assert.NotEqual("acc-1", conn.AccessToken);   // stored encrypted
        Assert.DoesNotContain("ref-1", conn.RefreshToken);
        var w = await db.Workouts.SingleAsync();
        Assert.Equal((MeasurementSource.Strava, "strava:11", "Trening siłowy", 45, (int?)412),
            (w.Source, w.ExternalKey, w.Type, w.Minutes, w.Kcal));
        Assert.Equal("Bearer acc-1", http.Auth.Last());
        Assert.NotNull(conn.LastActivityAt);
    }

    [Fact]
    public async Task Connect_WithoutActivityScope_StoresNothing()
    {
        var (db, strava, http) = Setup();
        Assert.Equal(StravaConnectOutcome.MissingScope, await strava.ConnectAsync(1, "code", "read"));
        Assert.Empty(http.Requests);
        Assert.False(await db.StravaConnections.AnyAsync());
    }

    [Fact]
    public async Task Connect_AthleteAlreadyLinkedToSomeoneElse_IsRefused()
    {
        var (db, strava, http) = Setup();
        db.StravaConnections.Add(new StravaConnection { PersonId = 2, AthleteId = 777 });
        await db.SaveChangesAsync();
        http.Map["POST /oauth/token"] = (HttpStatusCode.OK, Token("acc-1", "ref-1", DateTimeOffset.UtcNow.AddHours(6)));

        Assert.Equal(StravaConnectOutcome.Taken, await strava.ConnectAsync(1, "code", FullScope));
        Assert.Equal(2, (await db.StravaConnections.SingleAsync()).PersonId);
    }

    [Fact]
    public void State_RoundTrips_AndForgeriesAreRejected()
    {
        var (_, strava, _) = Setup(person: 3);
        var url = new Uri(strava.AuthorizeUrl("https://pichci.com/api/activity/strava/callback", 2));
        var query = Microsoft.AspNetCore.WebUtilities.QueryHelpers.ParseQuery(url.Query);

        Assert.Equal("12345", query["client_id"].ToString());
        Assert.Equal("activity:read_all", query["scope"].ToString());
        Assert.Equal(new StravaState(3, 2), strava.ReadState(query["state"]));
        Assert.Null(strava.ReadState("3:2:abc"));
        Assert.Null(strava.ReadState(null));
    }

    [Fact]
    public async Task ExpiredToken_IsRefreshed_AndTheNewPairSaved()
    {
        var (db, strava, http) = await Connected(expires: DateTimeOffset.UtcNow.AddMinutes(-1));
        http.Map["POST /oauth/token"] = (HttpStatusCode.OK, Token("acc-2", "ref-2", DateTimeOffset.UtcNow.AddHours(6), athlete: false));
        http.Map["GET /api/v3/activities/21"] = (HttpStatusCode.OK, Activity(21, "Run", Start, 1800, 300));

        Assert.Equal(StravaEventOutcome.Upserted, await strava.HandleEventAsync(Event("activity", "create", 21)));

        Assert.Contains("grant_type=refresh_token", http.Bodies.Last(b => b.Contains("grant_type")));
        Assert.Contains("refresh_token=ref-1", http.Bodies.Last(b => b.Contains("grant_type")));
        Assert.Equal("Bearer acc-2", http.Auth.Last());
        Assert.True((await db.StravaConnections.SingleAsync()).ExpiresAt > DateTimeOffset.UtcNow.AddHours(5));
        Assert.Equal("Bieganie", (await db.Workouts.SingleAsync()).Type);
    }

    [Fact]
    public async Task DeleteEvent_RemovesTheWorkout_OnlyWhenStravaConfirmsItIsGone()
    {
        var (db, strava, http) = await Connected();
        http.Map["GET /api/v3/activities/31"] = (HttpStatusCode.OK, Activity(31, "Walk", Start, 3600, 180));
        await strava.HandleEventAsync(Event("activity", "create", 31));

        // A forged delete: Strava still has the activity, so nothing goes.
        Assert.Equal(StravaEventOutcome.Upserted, await strava.HandleEventAsync(Event("activity", "delete", 31)));
        Assert.Single(await db.Workouts.ToListAsync());

        http.Map.Remove("GET /api/v3/activities/31");   // → 404
        Assert.Equal(StravaEventOutcome.Deleted, await strava.HandleEventAsync(Event("activity", "delete", 31)));
        Assert.Empty(await db.Workouts.ToListAsync());
    }

    [Fact]
    public async Task UpdateEvent_RewritesTheSameWorkout()
    {
        var (db, strava, http) = await Connected();
        http.Map["GET /api/v3/activities/41"] = (HttpStatusCode.OK, Activity(41, "Workout", Start, 1200, null));
        await strava.HandleEventAsync(Event("activity", "create", 41));
        http.Map["GET /api/v3/activities/41"] = (HttpStatusCode.OK, Activity(41, "Yoga", Start, 1500, 95));
        await strava.HandleEventAsync(Event("activity", "update", 41));

        var w = await db.Workouts.SingleAsync();
        Assert.Equal(("Joga", 25, (int?)95), (w.Type, w.Minutes, w.Kcal));
    }

    [Fact]
    public async Task Events_ForUnknownAthletes_AreIgnored()
    {
        var (_, strava, http) = await Connected();
        var before = http.Requests.Count;
        Assert.Equal(StravaEventOutcome.UnknownAthlete, await strava.HandleEventAsync(Event("activity", "create", 1) with { OwnerId = 999 }));
        Assert.Equal(before, http.Requests.Count);
    }

    [Fact]
    public async Task DeauthorizeEvent_DropsTheConnection_OnlyWhenStravaRefusesTheToken()
    {
        var (db, strava, http) = await Connected();
        var deauth = Event("athlete", "update", 777) with { Updates = new() { ["authorized"] = JsonSerializer.SerializeToElement("false") } };

        http.Map["GET /api/v3/athlete"] = (HttpStatusCode.OK, """{ "id": 777 }""");
        Assert.Equal(StravaEventOutcome.StillAuthorized, await strava.HandleEventAsync(deauth));
        Assert.True(await db.StravaConnections.AnyAsync());

        http.Map["GET /api/v3/athlete"] = (HttpStatusCode.Unauthorized, """{ "message": "Authorization Error" }""");
        Assert.Equal(StravaEventOutcome.Disconnected, await strava.HandleEventAsync(deauth));
        Assert.False(await db.StravaConnections.AnyAsync());
    }

    [Fact]
    public async Task Poll_SkipsKnownActivities()
    {
        var (db, strava, http) = await Connected();
        http.Map["GET /api/v3/athlete/activities"] = (HttpStatusCode.OK, $$"""[{ "id": 51, "start_date": "{{Start:yyyy-MM-ddTHH:mm:ssZ}}" }]""");
        http.Map["GET /api/v3/activities/51"] = (HttpStatusCode.OK, Activity(51, "Ride", Start, 3600, 500));
        var conn = await db.StravaConnections.SingleAsync();

        Assert.Equal(1, await strava.SyncAsync(conn, 3, refreshKnown: false));
        Assert.Equal(0, await strava.SyncAsync(conn, 3, refreshKnown: false));
        Assert.Equal(1, await strava.SyncAsync(conn, 3, refreshKnown: true));
        Assert.Single(await db.Workouts.ToListAsync());
    }

    // ---- the day's active kcal ----

    [Fact]
    public async Task Days_StravaKcalAdds_LikeAManualWorkout()
    {
        await using var db = NewDb();
        db.Workouts.Add(StravaWorkout(Start, 60, 450));
        await db.SaveChangesAsync();

        var day = Assert.Single(await new ActivityService(db).DaysAsync(LocalDay, LocalDay, bmr: null));
        Assert.Equal(450, day.ActiveKcal);
        Assert.Equal(450, Assert.Single(day.Workouts).Kcal);
    }

    [Fact]
    public async Task Days_BandSamplesInsideTheWindow_AreNotCountedTwice()
    {
        await using var db = NewDb();
        db.Workouts.Add(StravaWorkout(Start, 60, 450));
        db.EnergySamples.Add(Sample(EnergyKind.Active, Start.AddMinutes(5), 300));
        db.EnergySamples.Add(Sample(EnergyKind.Active, Start.AddHours(4), 100));
        await db.SaveChangesAsync();

        var day = Assert.Single(await new ActivityService(db).DaysAsync(LocalDay, LocalDay, bmr: null));
        Assert.Equal(400, day.ActiveKcal);   // band only; the watch's 450 is shown but not added
        Assert.Equal(450, Assert.Single(day.Workouts).Kcal);
    }

    [Fact]
    public async Task Days_TotalMinusBmrDay_AlreadyIncludesTheWorkout()
    {
        await using var db = NewDb();
        db.Workouts.Add(StravaWorkout(Start, 60, 450));
        db.EnergySamples.Add(Sample(EnergyKind.Total, Start.AddHours(-9), 2400));
        await db.SaveChangesAsync();

        var day = Assert.Single(await new ActivityService(db).DaysAsync(LocalDay, LocalDay, bmr: 1500));
        Assert.Equal(900, day.ActiveKcal);
    }

    [Fact]
    public async Task Days_SameSessionFromBandAndStrava_ShowsOnce()
    {
        await using var db = NewDb();
        db.Workouts.Add(StravaWorkout(Start.AddMinutes(2), 45, 400));
        db.Workouts.Add(new Workout { PersonId = 1, Date = LocalDay, StartedAt = Start, Minutes = 45, Type = "Bieganie", Source = MeasurementSource.HealthConnect, ExternalKey = "hc" });
        db.EnergySamples.Add(Sample(EnergyKind.Active, Start.AddMinutes(1), 380));
        await db.SaveChangesAsync();

        var day = Assert.Single(await new ActivityService(db).DaysAsync(LocalDay, LocalDay, bmr: null));
        Assert.Equal(MeasurementSource.HealthConnect, Assert.Single(day.Workouts).Workout.Source);
        Assert.Equal(380, day.ActiveKcal);
    }

    // ---- small pieces ----

    [Theory]
    [InlineData("WeightTraining", "Trening siłowy")]
    [InlineData("TrailRun", "Bieganie")]
    [InlineData("GravelRide", "Rower")]
    [InlineData("Snowboard", "Trening")]
    [InlineData(null, "Trening")]
    public void SportTypes_MapToTheDiaryLabels(string? sport, string label) => Assert.Equal(label, StravaService.Label(sport));

    [Fact]
    public void Options_DeriveTheWebhookFromAnHttpsApiBase_AndAStableVerifyToken()
    {
        static StravaOptions From(params (string, string?)[] kv) =>
            StravaOptions.From(new ConfigurationBuilder().AddInMemoryCollection(kv.Select(x => new KeyValuePair<string, string?>(x.Item1, x.Item2))).Build());

        var prod = From(("Strava:ClientId", "1"), ("Strava:ClientSecret", "x"), ("PUBLIC_API_BASE", "https://pichci.com/api/"));
        Assert.True(prod.Configured);
        Assert.Equal("https://pichci.com/api/strava/webhook", prod.WebhookUrl);
        Assert.Equal(prod.VerifyToken, From(("Strava:ClientSecret", "x")).VerifyToken);
        Assert.NotEqual(prod.VerifyToken, From(("Strava:ClientSecret", "y")).VerifyToken);

        var local = From(("PUBLIC_API_BASE", "http://localhost:5080/api"));
        Assert.False(local.Configured);
        Assert.Null(local.WebhookUrl);
    }

    // ---- helpers ----

    private static DateOnly LocalDay => ActivityService.LocalDate(Start);

    private static Workout StravaWorkout(DateTimeOffset start, int minutes, int kcal) => new()
    {
        PersonId = 1, Date = ActivityService.LocalDate(start), StartedAt = start, Minutes = minutes, Kcal = kcal,
        Type = "Bieganie", Source = MeasurementSource.Strava, ExternalKey = $"strava:{start.Ticks}",
    };

    private static EnergySample Sample(EnergyKind kind, DateTimeOffset start, decimal kcal) => new()
    {
        PersonId = 1, Kind = kind, Start = start, End = start.AddMinutes(30), Date = ActivityService.LocalDate(start), Kcal = kcal,
    };

    private static StravaEvent Event(string objectType, string aspect, long id) =>
        new(objectType, id, aspect, OwnerId: 777, SubscriptionId: 1, EventTime: DateTimeOffset.UtcNow.ToUnixTimeSeconds(), Updates: null);

    private static (MiseDbContext Db, StravaService Strava, FakeStrava Http) Setup(int person = 1)
    {
        var db = NewDb();
        var http = new FakeStrava();
        var strava = new StravaService(db, new StravaClient(new HttpClient(http)), Options, new EphemeralDataProtectionProvider(),
            person: new PersonScope(person));
        return (db, strava, http);
    }

    /// <summary>Person 1 connected as athlete 777 with an empty backfill.</summary>
    private static async Task<(MiseDbContext Db, StravaService Strava, FakeStrava Http)> Connected(DateTimeOffset? expires = null)
    {
        var (db, strava, http) = Setup();
        http.Map["POST /oauth/token"] = (HttpStatusCode.OK, Token("acc-1", "ref-1", expires ?? DateTimeOffset.UtcNow.AddHours(6)));
        http.Map["GET /api/v3/athlete/activities"] = (HttpStatusCode.OK, "[]");
        await strava.ConnectAsync(1, "code", FullScope);
        http.Map.Remove("POST /oauth/token");
        http.Map.Remove("GET /api/v3/athlete/activities");
        return (db, strava, http);
    }

    private static MiseDbContext NewDb() => new(new DbContextOptionsBuilder<MiseDbContext>()
        .UseInMemoryDatabase(Guid.NewGuid().ToString())
        .Options);

    /// <summary>Canned Strava: "METHOD /path" → (status, json); anything else is a 404.</summary>
    private sealed class FakeStrava : HttpMessageHandler
    {
        public readonly Dictionary<string, (HttpStatusCode Status, string Json)> Map = [];
        public readonly List<string> Requests = [];
        public readonly List<string> Bodies = [];
        public readonly List<string?> Auth = [];

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            var key = $"{request.Method} {request.RequestUri!.AbsolutePath}";
            Requests.Add(key);
            Auth.Add(request.Headers.Authorization?.ToString());
            if (request.Content is not null) Bodies.Add(await request.Content.ReadAsStringAsync(ct));
            var (status, json) = Map.TryGetValue(key, out var r) ? r : (HttpStatusCode.NotFound, """{ "message": "Record Not Found" }""");
            return new HttpResponseMessage(status) { Content = new StringContent(json, Encoding.UTF8, "application/json") };
        }
    }
}
