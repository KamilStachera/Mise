using Microsoft.EntityFrameworkCore;
using Mise.Api.Data;
using Mise.Api.Domain;
using Mise.Api.Features;
using Mise.Api.Services;
using Mise.Api.Services.Training;
using Xunit;
using Xunit.Abstractions;

namespace Mise.Api.Tests;

/// <summary>Template plans (no AI) over the real vendored catalog, validated by the same rules as agent plans.</summary>
public class TrainingTemplateTests(ITestOutputHelper output)
{
    private static readonly DateOnly Monday = new(2026, 11, 16);

    private static List<Exercise>? _catalog;

    private static async Task<List<Exercise>> CatalogAsync()
    {
        if (_catalog is not null) return _catalog;
        var options = new DbContextOptionsBuilder<MiseDbContext>().UseInMemoryDatabase("catalog-" + Guid.NewGuid()).Options;
        await using var db = new MiseDbContext(options, TenantContext.System());
        await ExerciseImport.EnsureImportedAsync(db);
        return _catalog = await db.Exercises.AsNoTracking().ToListAsync();
    }

    [Fact]
    public async Task HomeBodyweightBeginner_GetsThreeFullBodyDays_WithoutBarsOrGymKit()
    {
        var catalog = await CatalogAsync();
        var profile = new TrainingProfile
        {
            PersonId = 1, Goal = TrainingGoal.Tone, Level = ExerciseLevel.Beginner, DaysPerWeek = 3,
            MinutesPerSession = 45, Location = TrainingLocation.Home, HomeEquipment = [],
        };
        var input = Valid(profile, catalog, Monday, out var program);
        Print(input, catalog);

        Assert.Equal(TrainingTemplates.Weeks, program.Weeks);
        var week1 = program.Days.Where(d => d.Week == 1).OrderBy(d => d.Weekday).ToList();
        Assert.Equal(["Całe ciało A", "Całe ciało B", "Całe ciało C"], week1.Select(d => d.Name));
        Assert.Equal([0, 2, 4], week1.Select(d => d.Weekday));
        Assert.All(week1, d => Assert.Equal(5, d.Exercises.Count));
        var used = program.Days.SelectMany(d => d.Exercises).Select(x => catalog.First(c => c.Id == x.ExerciseId)).ToList();
        // No kit in the questionnaire = bodyweight only; nothing that needs a bar.
        Assert.All(used, e => Assert.Equal(ExerciseEquipment.BodyOnly, e.Equipment));
        Assert.DoesNotContain(used, e => e.SourceId is "Pullups" or "Chin-Up" or "Dips_-_Triceps_Version");
        Assert.All(used, e => Assert.True(e.Level <= ExerciseLevel.Intermediate));
    }

    [Fact]
    public async Task GymStrength_GetsUpperLower_WithHeavierMainLifts_ProgressionAndDeload()
    {
        var catalog = await CatalogAsync();
        var profile = new TrainingProfile
        {
            PersonId = 1, Goal = TrainingGoal.Strength, Level = ExerciseLevel.Intermediate, DaysPerWeek = 4,
            MinutesPerSession = 60, Location = TrainingLocation.Gym,
        };
        var input = Valid(profile, catalog, Monday, out var program);
        Print(input, catalog);

        var upperA = program.Days.Where(d => d.Name == "Góra A").OrderBy(d => d.Week).ToList();
        Assert.Equal(TrainingTemplates.Weeks, upperA.Count);
        Assert.Equal(["Góra A", "Dół A", "Góra B", "Dół B"],
            program.Days.Where(d => d.Week == 1).OrderBy(d => d.Weekday).Select(d => d.Name));
        var main = upperA.Select(d => d.Exercises.OrderBy(x => x.Order).First()).ToList();
        Assert.Equal((4, 5, 8), (main[0].Sets, main[0].RepsMin!.Value, main[0].RepsMax!.Value));
        Assert.Equal(5, main[2].Sets);                     // week 3: extra set
        Assert.Equal((6, 10), (main[4].RepsMin!.Value, main[4].RepsMax!.Value)); // week 5: more reps
        Assert.Equal(3, main[5].Sets);                     // week 6: lighter
        Assert.Equal(6, upperA[0].Exercises.Count);
        // Same workout, same exercises every week — progression, not a new plan each week.
        Assert.All(upperA, d => Assert.Equal(upperA[0].Exercises.Select(x => x.ExerciseId), d.Exercises.OrderBy(x => x.Order).Select(x => x.ExerciseId)));
    }

    [Fact]
    public async Task PlanStartingMidWeek_SkipsDaysBeforeTheStart()
    {
        var catalog = await CatalogAsync();
        var profile = new TrainingProfile { PersonId = 1, DaysPerWeek = 3, Location = TrainingLocation.Home, HomeEquipment = ["Dumbbell"] };
        Valid(profile, catalog, Monday.AddDays(3), out var program); // Thursday

        Assert.Equal([4], program.Days.Where(d => d.Week == 1).Select(d => d.Weekday)); // only Friday left
        Assert.Equal(3, program.Days.Count(d => d.Week == 2));
    }

    [Fact]
    public async Task PlanPickedAfterTheWeeksLastWorkout_StartsNextMonday()
    {
        var catalog = await CatalogAsync();
        var profile = new TrainingProfile { PersonId = 1, DaysPerWeek = 3, Location = TrainingLocation.Gym };
        var input = Valid(profile, catalog, Monday.AddDays(5), out var program); // Saturday

        Assert.Equal(Monday.AddDays(7), input.StartDate);
        Assert.Equal(3 * TrainingTemplates.Weeks, program.Days.Count);
    }

    [Fact]
    public async Task OnlyYogaOrPilates_IsNotSomethingATemplateCanDo()
    {
        var profile = new TrainingProfile { PersonId = 1, Styles = ["yoga", "pilates"] };
        var (input, error) = TrainingTemplates.Build(profile, await CatalogAsync(), Monday);
        Assert.Null(input);
        Assert.Contains("Sous", error);
    }

    [Theory]
    [InlineData(3, 0b0010101, new[] { 0, 2, 4 })]   // Mon/Wed/Fri as asked
    [InlineData(2, 0b0101010, new[] { 1, 3 })]      // two of Tue/Thu/Sat
    [InlineData(3, 0b0100000, new[] { 0, 2, 5 })]   // Saturday + defaults
    [InlineData(4, 0, new[] { 0, 1, 3, 4 })]
    public void Weekdays_FollowTheQuestionnaire(int count, int mask, int[] expected) =>
        Assert.Equal(expected, TrainingTemplates.PickWeekdays(count, mask));

    private static TrainingProgramInput Valid(TrainingProfile profile, List<Exercise> catalog, DateOnly start, out TrainingProgram program)
    {
        var (input, error) = TrainingTemplates.Build(profile, catalog, start);
        Assert.Null(error);
        program = new TrainingProgram { PersonId = 1 };
        Assert.Null(TrainingRules.ApplyHeader(program, input!, start));
        Assert.Null(TrainingRules.BuildDays(program, input!.Days!, catalog.ToDictionary(e => e.Id), out var days));
        program.Days = days;
        return input;
    }

    private void Print(TrainingProgramInput input, List<Exercise> catalog)
    {
        output.WriteLine(input.Name + " — " + input.Description);
        foreach (var day in input.Days!.Where(d => d.Week == 1))
        {
            output.WriteLine($"  {TrainingRules.WeekdayNames[day.Weekday]}: {day.Name}");
            foreach (var x in day.Exercises!)
            {
                var e = catalog.First(c => c.Id == x.ExerciseId);
                var dose = x.Seconds is { } s ? $"{x.Sets}×{s}s" : $"{x.Sets}×{x.RepsMin}–{x.RepsMax}";
                output.WriteLine($"    {e.SourceId,-38} {e.Equipment,-10} {dose}, przerwa {x.RestSeconds}s");
            }
        }
    }
}
