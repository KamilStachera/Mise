using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Mise.Api.Data;
using Mise.Api.Domain;
using Mise.Api.Services;
using Xunit;

namespace Mise.Api.Tests;

public class ActivityServiceTests
{
    // Mid-day UTC instants, so the local day is the same in any server time zone a test runs in.
    private static readonly DateTimeOffset Day = new(2026, 10, 13, 10, 0, 0, TimeSpan.Zero);

    /// <summary>The shape HC Webhook posts (docs/webhook.md): snake_case arrays, ISO instants.</summary>
    private static HcPayload Parse(string json) => JsonSerializer.Deserialize<HcPayload>(json)!;

    private const string Payload = """
        {
          "timestamp": "2026-10-13T15:00:00Z",
          "app_version": "2.4.0",
          "steps": [{ "count": 7412, "start_time": "2026-10-13T00:00:00Z", "end_time": "2026-10-13T15:00:00Z" }],
          "active_calories": [
            { "calories": 120.5, "start_time": "2026-10-13T10:00:00Z", "end_time": "2026-10-13T10:30:00Z" },
            { "calories": 189.5, "start_time": "2026-10-13T10:30:00Z", "end_time": "2026-10-13T10:45:00Z" },
            { "calories": 40, "start_time": "2026-10-13T13:00:00Z", "end_time": "2026-10-13T14:00:00Z" }
          ],
          "exercise": [{ "type": "STRENGTH_TRAINING", "start_time": "2026-10-13T10:00:00Z", "end_time": "2026-10-13T10:45:00Z", "duration_seconds": 2700 }],
          "weight": [
            { "kilograms": 71.4, "time": "2026-10-13T07:05:00Z" },
            { "kilograms": 71.9, "time": "2026-10-13T11:30:00Z" }
          ]
        }
        """;

    [Fact]
    public async Task Ingest_SumsActiveKcal_DerivesWorkoutKcal_AndKeepsTheMorningWeight()
    {
        await using var db = NewDb();
        var activity = new ActivityService(db);
        var sync = await activity.SyncAsync();

        var r = await activity.IngestAsync(sync, Parse(Payload));

        Assert.Equal((3, 1, 1), (r.Energy, r.Workouts, r.Weights));
        var day = Assert.Single(await activity.DaysAsync(DateOnly.FromDateTime(Day.LocalDateTime), DateOnly.FromDateTime(Day.LocalDateTime), bmr: null));
        Assert.Equal(350, day.ActiveKcal);
        var (workout, kcal) = Assert.Single(day.Workouts);
        Assert.Equal("Trening siłowy", workout.Type);
        Assert.Equal(45, workout.Minutes);
        Assert.Equal(310, kcal);   // only the samples inside the session
        Assert.Equal(71.4m, (await db.WeightEntries.SingleAsync()).Kg);
        Assert.NotNull(sync.LastSyncAt);
    }

    [Fact]
    public async Task Ingest_IsIdempotent_AndUpdatesResentSamples()
    {
        await using var db = NewDb();
        var activity = new ActivityService(db);
        var sync = await activity.SyncAsync();
        await activity.IngestAsync(sync, Parse(Payload));
        await activity.IngestAsync(sync, Parse(Payload.Replace("\"calories\": 40", "\"calories\": 55")));

        Assert.Equal(3, await db.EnergySamples.CountAsync());
        Assert.Equal(1, await db.Workouts.CountAsync());
        var date = DateOnly.FromDateTime(Day.LocalDateTime);
        Assert.Equal(365, (await activity.DaysAsync(date, date, null)).Single().ActiveKcal);
    }

    [Fact]
    public async Task ScaleNeverOverwritesAManualWeighIn()
    {
        await using var db = NewDb();
        var date = DateOnly.FromDateTime(new DateTimeOffset(2026, 10, 13, 7, 5, 0, TimeSpan.Zero).LocalDateTime);
        db.WeightEntries.Add(new WeightEntry { Date = date, Kg = 70.9m, Source = MeasurementSource.Manual });
        await db.SaveChangesAsync();
        var activity = new ActivityService(db);

        await activity.IngestAsync(await activity.SyncAsync(), Parse(Payload));

        Assert.Equal(70.9m, (await db.WeightEntries.SingleAsync()).Kg);
    }

    [Fact]
    public async Task OnlyTotalCalories_CountAboveBmr_AndManualWorkoutsAdd()
    {
        await using var db = NewDb();
        var date = new DateOnly(2026, 10, 1);   // a past day: the whole BMR applies
        db.EnergySamples.Add(new EnergySample { Kind = EnergyKind.Total, Date = date, Start = Day.AddDays(-12), End = Day.AddDays(-12).AddHours(23), Kcal = 1900 });
        db.Workouts.Add(new Workout { Date = date, Minutes = 40, Kcal = 140, Type = "Spacer", Source = MeasurementSource.Manual });
        await db.SaveChangesAsync();

        var day = (await new ActivityService(db).DaysAsync(date, date, bmr: 1450)).Single();

        Assert.Equal(450 + 140, day.ActiveKcal);
    }

    [Fact]
    public async Task UnknownToken_IsRejected_RotateInvalidatesTheOldOne()
    {
        await using var db = NewDb();
        var activity = new ActivityService(db);
        var old = (await activity.SyncAsync()).Token;
        Assert.NotNull(await activity.AuthorizeAsync(old));
        Assert.Null(await activity.AuthorizeAsync("deadbeef"));

        await activity.SyncAsync(rotate: true);
        Assert.Null(await activity.AuthorizeAsync(old));
    }

    [Theory]
    [InlineData("\"WALKING\"", "Spacer")]
    [InlineData("\"EXERCISE_TYPE_BIKING\"", "Rower")]
    [InlineData("56", "Bieganie")]
    [InlineData("\"70\"", "Trening siłowy")]
    [InlineData("\"PADDLING\"", "Trening")]
    public void ExerciseTypes_MapToPolishLabels(string json, string label) =>
        Assert.Equal(label, ActivityService.ExerciseLabel(JsonDocument.Parse(json).RootElement));

    [Fact]
    public void OpenFoodFacts_ParsesNumbersAndNumericStrings()
    {
        var json = """
            { "code": "8000500167113", "status": 1, "product": {
              "product_name": "Kinder Bueno", "brands": "Ferrero, Kinder",
              "serving_quantity": "21.5", "serving_size": "1 batonik (21,5 g)",
              "nutriments": { "energy-kcal_100g": 571, "proteins_100g": 8.6, "fat_100g": "37.3", "carbohydrates_100g": 49.5 } } }
            """;
        var p = OpenFoodFacts.Parse(JsonDocument.Parse(json).RootElement)!;

        Assert.Equal(("Kinder Bueno", "Ferrero", 571), (p.Name, p.Brand, p.KcalPer100g!.Value));
        Assert.Equal(37.3m, p.Fat);
        Assert.Equal(21.5m, p.ServingGrams);
        Assert.Null(OpenFoodFacts.Parse(JsonDocument.Parse("""{ "status": 0 }""").RootElement));
    }

    private static MiseDbContext NewDb() => new(new DbContextOptionsBuilder<MiseDbContext>()
        .UseInMemoryDatabase(Guid.NewGuid().ToString())
        .Options);
}
