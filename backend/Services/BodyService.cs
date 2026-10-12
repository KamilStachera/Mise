using Microsoft.EntityFrameworkCore;
using Mise.Api.Data;
using Mise.Api.Domain;

namespace Mise.Api.Services;

/// <summary>Computed targets for a profile at a given weight.</summary>
public readonly record struct BodyTargets(int Bmr, int Tdee, int Computed, int Target, int Protein);

/// <summary>One weigh-in with its 7-day trend (trailing mean of the weigh-ins in that window).</summary>
public readonly record struct WeightPoint(DateOnly Date, decimal Kg, decimal Trend);

/// <summary>A day's food against its budget, for the weekly summary and streak.</summary>
public readonly record struct DayIntake(DateOnly Date, int Eaten, int Budget, bool Logged);

/// <summary>
/// "Twój cel" maths and the progress summary: BMR → TDEE → daily target, the weight trend,
/// the week's deficit and the logging streak. Pure functions where possible so tests can
/// reach them without a database.
/// </summary>
public class BodyService(MiseDbContext db)
{
    /// <summary>≈ 7700 kcal of deficit per kg of body fat — the usual rule of thumb.</summary>
    public const int KcalPerKg = 7700;
    /// <summary>Never suggest less than this; below it a diet needs a doctor, not an app.</summary>
    public const int FloorFemale = 1200, FloorMale = 1500;
    public const decimal ProteinPerKg = 1.6m;
    public const int TrendDays = 7;

    public static double ActivityFactor(ActivityLevel level) => level switch
    {
        ActivityLevel.Sedentary => 1.2,
        ActivityLevel.Light => 1.375,
        ActivityLevel.Moderate => 1.55,
        _ => 1.725,
    };

    /// <summary>Mifflin-St Jeor resting energy, kcal/day.</summary>
    public static int Bmr(BodySex sex, decimal kg, int heightCm, int age) =>
        (int)Math.Round(10 * (double)kg + 6.25 * heightCm - 5 * age + (sex == BodySex.Male ? 5 : -161));

    public static BodyTargets Targets(BodyProfile p, decimal currentKg, DateOnly today)
    {
        var age = Math.Clamp(today.Year - p.BirthYear, 14, 100);
        var bmr = Bmr(p.Sex, currentKg, p.HeightCm, age);
        var tdee = (int)Math.Round(bmr * ActivityFactor(p.ActivityLevel));
        var deficit = (double)p.PaceKgPerWeek * KcalPerKg / 7;
        var floor = p.Sex == BodySex.Male ? FloorMale : FloorFemale;
        var computed = Math.Max(floor, RoundTo(tdee - deficit, 10));
        var protein = p.ProteinTargetOverride ?? RoundTo((double)(currentKg * ProteinPerKg), 5);
        return new(bmr, tdee, computed, p.TargetKcalOverride ?? computed, protein);
    }

    /// <summary>The day's budget: target plus the configured share of band-recorded active kcal.</summary>
    public static int Budget(int target, int activeKcal, int addBackPercent) =>
        target + (int)Math.Round(activeKcal * addBackPercent / 100.0);

    private static int RoundTo(double v, int step) => (int)(Math.Round(v / step) * step);

    /// <summary>Each weigh-in with the mean of all weigh-ins in the trailing <see cref="TrendDays"/> days.</summary>
    public static List<WeightPoint> Trend(IReadOnlyList<WeightEntry> entries)
    {
        var sorted = entries.OrderBy(e => e.Date).ToList();
        return sorted.Select(e =>
        {
            var window = sorted.Where(w => w.Date > e.Date.AddDays(-TrendDays) && w.Date <= e.Date).ToList();
            return new WeightPoint(e.Date, e.Kg, Math.Round(window.Average(w => w.Kg), 2));
        }).ToList();
    }

    /// <summary>Consecutive days with something eaten, ending today (or yesterday, if today is still empty).</summary>
    public static int Streak(IReadOnlySet<DateOnly> loggedDays, DateOnly today)
    {
        var day = loggedDays.Contains(today) ? today : today.AddDays(-1);
        var streak = 0;
        while (loggedDays.Contains(day))
        {
            streak++;
            day = day.AddDays(-1);
        }
        return streak;
    }

    public Task<BodyProfile?> ProfileAsync(CancellationToken ct = default) =>
        db.BodyProfiles.AsNoTracking().FirstOrDefaultAsync(p => p.Id == 1, ct);

    public Task<WeightEntry?> LatestWeightAsync(DateOnly? onOrBefore = null, CancellationToken ct = default) =>
        db.WeightEntries.AsNoTracking()
            .Where(w => onOrBefore == null || w.Date <= onOrBefore)
            .OrderByDescending(w => w.Date)
            .FirstOrDefaultAsync(ct);

    /// <summary>One weigh-in per day: a second one the same day replaces the first.</summary>
    public async Task<WeightEntry> SetWeightAsync(DateOnly date, decimal kg, MeasurementSource source, CancellationToken ct = default)
    {
        if (kg is < 25 or > 350) throw new DiaryException("Waga poza zakresem.");
        var entry = await db.WeightEntries.FirstOrDefaultAsync(w => w.Date == date, ct);
        if (entry is null)
        {
            entry = new WeightEntry { Date = date };
            db.WeightEntries.Add(entry);
        }
        entry.Kg = Math.Round(kg, 2);
        entry.Source = source;
        entry.MeasuredAt = null;
        entry.CreatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);
        return entry;
    }

    /// <summary>
    /// Eaten kcal and budget for each day in [from, to]. A day counts as logged when it has
    /// at least one eaten entry; budgets use today's target (the target is fixed by design).
    /// </summary>
    public async Task<List<DayIntake>> IntakeAsync(DateOnly from, DateOnly to, int target, int addBackPercent,
        IReadOnlyDictionary<DateOnly, int> activeKcal, CancellationToken ct = default)
    {
        var eaten = await db.PlanEntries.AsNoTracking()
            .Include(e => e.Recipe)
            .Where(e => e.Date >= from && e.Date <= to && e.EatenAt != null)
            .ToListAsync(ct);
        var byDay = eaten.GroupBy(e => e.Date)
            .ToDictionary(g => g.Key, g => g.Sum(e => DiaryService.Nutrition(e).Kcal ?? 0));
        var days = new List<DayIntake>();
        for (var d = from; d <= to; d = d.AddDays(1))
        {
            var budget = Budget(target, activeKcal.GetValueOrDefault(d), addBackPercent);
            days.Add(new DayIntake(d, byDay.GetValueOrDefault(d), budget, byDay.ContainsKey(d)));
        }
        return days;
    }

    /// <summary>Days with at least one eaten entry, going back far enough for any streak worth showing.</summary>
    public async Task<HashSet<DateOnly>> LoggedDaysAsync(DateOnly today, int lookback = 366, CancellationToken ct = default)
    {
        var from = today.AddDays(-lookback);
        var days = await db.PlanEntries.AsNoTracking()
            .Where(e => e.Date >= from && e.Date <= today && e.EatenAt != null)
            .Select(e => e.Date).Distinct().ToListAsync(ct);
        return days.ToHashSet();
    }
}
