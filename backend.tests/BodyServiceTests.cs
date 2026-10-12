using Mise.Api.Domain;
using Mise.Api.Services;
using Xunit;

namespace Mise.Api.Tests;

public class BodyServiceTests
{
    private static readonly DateOnly Today = new(2026, 10, 14);

    [Fact]
    public void Targets_FollowMifflinStJeorAndThePaceDeficit()
    {
        // 31 y, 168 cm, 71.2 kg woman, light activity, −0.5 kg/week (the design's sample).
        var p = new BodyProfile { Sex = BodySex.Female, BirthYear = 1995, HeightCm = 168, GoalWeightKg = 64, ActivityLevel = ActivityLevel.Light, PaceKgPerWeek = 0.5m };

        var t = BodyService.Targets(p, 71.2m, Today);

        Assert.Equal(1446, t.Bmr);          // 712 + 1050 − 155 − 161
        Assert.Equal(1988, t.Tdee);         // × 1.375
        Assert.Equal(1440, t.Target);       // − 550 (0.5 × 7700 / 7), rounded to 10
        Assert.Equal(115, t.Protein);       // 1.6 g × 71.2 kg, rounded to 5
    }

    [Fact]
    public void Targets_NeverGoBelowTheFloor_AndOverridesWin()
    {
        var p = new BodyProfile { Sex = BodySex.Female, BirthYear = 1960, HeightCm = 150, GoalWeightKg = 45, ActivityLevel = ActivityLevel.Sedentary, PaceKgPerWeek = 0.75m };
        Assert.Equal(BodyService.FloorFemale, BodyService.Targets(p, 50, Today).Target);

        p.TargetKcalOverride = 1650;
        p.ProteinTargetOverride = 110;
        var t = BodyService.Targets(p, 50, Today);
        Assert.Equal(1650, t.Target);
        Assert.Equal(110, t.Protein);
    }

    [Fact]
    public void Budget_AddsBackTheConfiguredShareOfActivity()
    {
        Assert.Equal(1805, BodyService.Budget(1650, 310, 50));
        Assert.Equal(1650, BodyService.Budget(1650, 310, 0));
    }

    [Fact]
    public void Trend_IsTheTrailingWeekMean()
    {
        var entries = new List<WeightEntry>
        {
            new() { Date = Today.AddDays(-10), Kg = 72.0m },
            new() { Date = Today.AddDays(-2), Kg = 71.0m },
            new() { Date = Today, Kg = 71.6m },
        };

        var trend = BodyService.Trend(entries);

        Assert.Equal(72.0m, trend[0].Trend);
        Assert.Equal(71.0m, trend[1].Trend);   // the −10 day is outside its 7-day window
        Assert.Equal(71.3m, trend[2].Trend);
    }

    [Fact]
    public void Streak_CountsBackFromTodayOrYesterday()
    {
        var days = new HashSet<DateOnly> { Today.AddDays(-1), Today.AddDays(-2), Today.AddDays(-4) };
        Assert.Equal(2, BodyService.Streak(days, Today));
        days.Add(Today);
        Assert.Equal(3, BodyService.Streak(days, Today));
        Assert.Equal(0, BodyService.Streak(new HashSet<DateOnly>(), Today));
    }
}
