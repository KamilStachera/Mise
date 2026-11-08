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
using Mise.Api.Services.Training;
using Xunit;

namespace Mise.Api.Tests;

public class TrainingProgramTests
{
    // 2026-11-11 is a Wednesday.
    private static readonly DateOnly Wednesday = new(2026, 11, 11);

    private static TrainingProgram Program(DateOnly start, int weeks, params (int Week, int Weekday, string Name)[] days) => new()
    {
        StartDate = start,
        Weeks = weeks,
        Days = days.Select(d => new ProgramDay { Week = d.Week, Weekday = d.Weekday, Name = d.Name }).ToList(),
    };

    [Fact]
    public void Schedule_PlacesWeeksFromTheMondayOfTheStart()
    {
        var p = Program(Wednesday, 2, (1, 2, "A"), (1, 4, "B"), (2, 0, "C"));
        Assert.Equal(new DateOnly(2026, 11, 9), ProgramSchedule.MondayOf(Wednesday));
        Assert.Equal(Wednesday, ProgramSchedule.DateOf(p, p.Days[0]));
        Assert.Equal(new DateOnly(2026, 11, 16), ProgramSchedule.DateOf(p, p.Days[2]));
        Assert.Equal(new DateOnly(2026, 11, 22), ProgramSchedule.EndDate(p));

        var today = ProgramSchedule.Resolve(p, Wednesday);
        Assert.Equal(ProgramSchedule.State.Scheduled, today.State);
        Assert.Equal("A", today.Day!.Name);
        Assert.Equal("B", today.Next!.Name);

        var rest = ProgramSchedule.Resolve(p, Wednesday.AddDays(1));
        Assert.Equal(ProgramSchedule.State.Rest, rest.State);
        Assert.Equal(1, rest.Week);
        Assert.Equal("B", rest.Next!.Name);

        var weekTwo = ProgramSchedule.Resolve(p, new DateOnly(2026, 11, 16));
        Assert.Equal((ProgramSchedule.State.Scheduled, 2, "C"), (weekTwo.State, weekTwo.Week, weekTwo.Day!.Name));
        Assert.Null(weekTwo.Next);
    }

    [Fact]
    public void Schedule_BeforeStartAndAfterEnd()
    {
        var p = Program(Wednesday, 1, (1, 2, "A"));
        var before = ProgramSchedule.Resolve(p, Wednesday.AddDays(-5));
        Assert.Equal(ProgramSchedule.State.BeforeStart, before.State);
        Assert.Equal("A", before.Next!.Name);
        Assert.Equal(ProgramSchedule.State.Finished, ProgramSchedule.Resolve(p, Wednesday.AddDays(5)).State);
    }

    private static Exercise Ex(string name, ExerciseLevel level, ExerciseEquipment eq, string[] primary,
        string[]? secondary = null, ExerciseMechanic? mech = ExerciseMechanic.Compound, bool hidden = false, bool timed = false) => new()
    {
        NameEn = name,
        Level = level,
        Equipment = eq,
        PrimaryMuscles = primary.ToList(),
        SecondaryMuscles = (secondary ?? []).ToList(),
        Mechanic = mech,
        Hidden = hidden,
        IsTimed = timed,
    };

    [Fact]
    public void Alternatives_ShareAPrimaryMuscle_RespectEquipmentAndDirection()
    {
        var squat = Ex("Barbell Squat", ExerciseLevel.Intermediate, ExerciseEquipment.Barbell, ["Quadriceps"], ["Glutes", "Hamstrings"]);
        var goblet = Ex("Goblet Squat", ExerciseLevel.Beginner, ExerciseEquipment.Kettlebell, ["Quadriceps"], ["Glutes"]);
        var bodyweight = Ex("Bodyweight Squat", ExerciseLevel.Beginner, ExerciseEquipment.BodyOnly, ["Quadriceps"], ["Glutes"]);
        var front = Ex("Front Squat", ExerciseLevel.Expert, ExerciseEquipment.Barbell, ["Quadriceps"]);
        var curl = Ex("Biceps Curl", ExerciseLevel.Beginner, ExerciseEquipment.Dumbbell, ["Biceps"], mech: ExerciseMechanic.Isolation);
        var hidden = Ex("Hidden Squat", ExerciseLevel.Beginner, ExerciseEquipment.BodyOnly, ["Quadriceps"], hidden: true);
        var all = new[] { squat, goblet, bodyweight, front, curl, hidden };

        var easier = ExerciseAlternatives.For(squat, all, null, ExerciseAlternatives.Direction.Easier);
        Assert.DoesNotContain(front, easier);
        Assert.DoesNotContain(curl, easier);
        Assert.DoesNotContain(hidden, easier);
        Assert.DoesNotContain(squat, easier);
        Assert.Equal(2, easier.Count);

        var harder = ExerciseAlternatives.For(squat, all, null, ExerciseAlternatives.Direction.Harder);
        Assert.Equal([front], harder);

        var noKit = ExerciseAlternatives.For(squat, all, ExerciseAlternatives.AllowedFor("none", null), ExerciseAlternatives.Direction.Similar);
        Assert.Equal([bodyweight], noKit);

        // Home: her profile kit + bodyweight; a barbell isn't in it.
        var profile = new TrainingProfile { HomeEquipment = ["Kettlebell"] };
        var home = ExerciseAlternatives.For(squat, all, ExerciseAlternatives.AllowedFor("home", profile), ExerciseAlternatives.Direction.Similar);
        Assert.Equal(2, home.Count);
        Assert.DoesNotContain(front, home);
        Assert.Null(ExerciseAlternatives.AllowedFor("gym", profile));
    }

    private static Dictionary<Guid, Exercise> Catalog(params Exercise[] items) => items.ToDictionary(e => e.Id);

    [Fact]
    public void BuildDays_ValidatesGridStartAndTargets()
    {
        var plank = Ex("Plank", ExerciseLevel.Beginner, ExerciseEquipment.BodyOnly, ["Abdominals"], timed: true);
        var lunge = Ex("Lunge", ExerciseLevel.Beginner, ExerciseEquipment.Dumbbell, ["Quadriceps"]);
        var catalog = Catalog(plank, lunge);
        var p = new TrainingProgram { StartDate = Wednesday, Weeks = 2 };
        ProgramDayInput Day(int week, int weekday, params ProgramExerciseInput[] ex)
            => new(week, weekday, "Dół", null, null, null, null, null, null, ex.ToList());
        ProgramExerciseInput Slot(Exercise e, int? sets = null, int? repsMin = null, int? repsMax = null, int? seconds = null)
            => new(e.Id, sets, repsMin, repsMax, seconds, null, null, null, null);

        Assert.Null(TrainingRules.BuildDays(p, [Day(1, 2, Slot(lunge), Slot(plank)), Day(2, 0, Slot(lunge, 4, 8, 10))], catalog, out var days));
        Assert.Equal((10, 12, (int?)null), (days[0].Exercises[0].RepsMin!.Value, days[0].Exercises[0].RepsMax!.Value, days[0].Exercises[0].Seconds));
        Assert.Equal(30, days[0].Exercises[1].Seconds);            // timed default
        Assert.Equal(1, days[0].Exercises[1].Order);
        Assert.Equal(4, days[1].Exercises[0].Sets);

        Assert.Contains("przed datą startu", TrainingRules.BuildDays(p, [Day(1, 0, Slot(lunge))], catalog, out _));
        Assert.Contains("dwa treningi", TrainingRules.BuildDays(p, [Day(1, 3, Slot(lunge)), Day(1, 3, Slot(plank))], catalog, out _));
        Assert.Contains("Tydzień 3", TrainingRules.BuildDays(p, [Day(3, 0, Slot(lunge))], catalog, out _));
        Assert.Contains("bez ćwiczeń", TrainingRules.BuildDays(p, [Day(1, 3)], catalog, out _));
        Assert.Contains("ćwiczenie 1: nie ma ćwiczenia", TrainingRules.BuildDays(p,
            [Day(1, 3, new ProgramExerciseInput(Guid.NewGuid(), 3, null, null, null, null, null, null, null))], catalog, out _));
        Assert.Contains("ALBO", TrainingRules.BuildDays(p, [Day(1, 3, Slot(plank, seconds: 30, repsMin: 10))], catalog, out _));
        Assert.Contains("repsMin większe", TrainingRules.BuildDays(p, [Day(1, 3, Slot(lunge, repsMin: 12, repsMax: 8))], catalog, out _));
    }

    [Fact]
    public void BuildDay_FollowAlongNeedsAVideoAndNoExercises()
    {
        var p = new TrainingProgram { StartDate = Wednesday, Weeks = 1 };
        var none = new Dictionary<Guid, Exercise>();
        Assert.Contains("videoYoutubeId", TrainingRules.BuildDay(p,
            new ProgramDayInput(1, 4, "Pilates", "follow-along", null, null, null, 30, "Pilates", null), none, out _));
        Assert.Null(TrainingRules.BuildDay(p,
            new ProgramDayInput(1, 4, "Pilates", "follow-along", "home", null, "https://youtu.be/AAAAAAAAAAA", 30, "Pilates", null), none, out var day));
        Assert.Equal((ProgramDayKind.FollowAlong, "AAAAAAAAAAA", TrainingLocation.Home), (day!.Kind, day.VideoYoutubeId, day.Location));
    }

    [Fact]
    public void Profile_ValidatesTokensAndKeepsUnsetFields()
    {
        var p = new TrainingProfile { PersonId = 1, MinutesPerSession = 40 };
        Assert.Null(TrainingRules.ApplyProfile(p, new TrainingProfileInput("tone", "beginner", 3, null, 0b0010101, "home",
            ["dumbbell", "bands", "body-only"], ["strength", "pilates"], "kolano", null, null)));
        Assert.Equal((TrainingGoal.Tone, TrainingLocation.Home, 40), (p.Goal, p.Location, p.MinutesPerSession));
        Assert.Equal(["Dumbbell", "Bands"], p.HomeEquipment); // bodyweight is implied
        Assert.Equal("kolano", p.Limitations);

        Assert.Contains("goal", TrainingRules.ApplyProfile(p, new TrainingProfileInput("bulk", null, null, null, null, null, null, null, null, null, null)));
        Assert.Contains("styles", TrainingRules.ApplyProfile(p, new TrainingProfileInput(null, null, null, null, null, null, null, ["zumba"], null, null, null)));
        Assert.Contains("daysPerWeek", TrainingRules.ApplyProfile(p, new TrainingProfileInput(null, null, 9, null, null, null, null, null, null, null, null)));
        Assert.Equal(TrainingGoal.Tone, p.Goal); // failed input left it alone
    }

    [Fact]
    public async Task TrainingRoutes_ArePrivate_EvenForReads()
    {
        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseTestServer();
        var dbName = Guid.NewGuid().ToString();
        builder.Services.AddDbContext<MiseDbContext>(o => o.UseInMemoryDatabase(dbName));
        builder.Services.AddSingleton<AccessControl>();
        builder.Services.AddSingleton(new PersonScope(1));
        builder.Services.AddSingleton<EnrichmentState>();
        builder.Services.AddSingleton(new YouTubeVerifier(new NoHttp()));
        await using var app = builder.Build();
        app.UseMiddleware<ApiAccessMiddleware>();
        app.MapGroup("/api").MapTraining();
        await app.StartAsync();
        using var client = app.GetTestClient();

        foreach (var path in new[] { "/api/training/profile", "/api/training/program", "/api/training/today" })
            Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync(path)).StatusCode);
    }

    private sealed class NoHttp : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => throw new InvalidOperationException("no network in tests");
    }
}
