using Microsoft.EntityFrameworkCore;
using Mise.Api.Data;
using Mise.Api.Domain;
using Mise.Api.Services;

namespace Mise.Api.Features;

/// <summary>
/// "Twój cel", weigh-ins, the daily budget and progress. Private, reads included — /api/body
/// is in ApiAccessMiddleware's private list.
/// </summary>
public static class BodyEndpoints
{
    public static RouteGroupBuilder MapBody(this RouteGroupBuilder api)
    {
        var g = api.MapGroup("/body").WithTags("Body");

        g.MapGet("/", async (BodyService body) =>
        {
            var today = DateOnly.FromDateTime(DateTime.Today);
            return Results.Ok(ToDto(await body.ProfileAsync(), (await body.LatestWeightAsync())?.Kg, today));
        });

        g.MapPut("/", async (BodyInput input, MiseDbContext db, BodyService body) =>
        {
            var today = DateOnly.FromDateTime(DateTime.Today);
            if (input.BirthYear < today.Year - 100 || input.BirthYear > today.Year - 14)
                return Results.BadRequest(new { error = "Rok urodzenia poza zakresem." });
            if (input.HeightCm is < 120 or > 230) return Results.BadRequest(new { error = "Wzrost poza zakresem." });
            if (input.GoalKg is < 30 or > 300) return Results.BadRequest(new { error = "Waga docelowa poza zakresem." });
            if (input.PaceKg is < 0 or > 1) return Results.BadRequest(new { error = "Tempo od 0 do 1 kg na tydzień." });
            if (input.TargetOverride is < 800 or > 5000) return Results.BadRequest(new { error = "Cel kcal poza zakresem." });
            if (!Enum.TryParse<BodySex>(input.Sex, true, out var sex) || !Enum.TryParse<ActivityLevel>(input.ActivityLevel, true, out var level))
                return Results.BadRequest(new { error = "Nieznana płeć albo poziom aktywności." });

            var p = await db.BodyProfiles.FirstOrDefaultAsync(x => x.PersonId == body.PersonId);
            if (p is null)
            {
                p = new BodyProfile { PersonId = body.PersonId };
                db.BodyProfiles.Add(p);
            }
            p.Sex = sex;
            p.BirthYear = input.BirthYear;
            p.HeightCm = input.HeightCm;
            p.GoalWeightKg = Math.Round(input.GoalKg, 1);
            p.ActivityLevel = level;
            p.PaceKgPerWeek = input.PaceKg;
            p.TargetKcalOverride = input.TargetOverride;
            p.ProteinTargetOverride = input.ProteinOverride is > 0 ? input.ProteinOverride : null;
            p.ActivityAddBackPercent = Math.Clamp(input.AddBackPercent, 0, 100);
            p.UpdatedAt = DateTimeOffset.UtcNow;
            await db.SaveChangesAsync();
            try
            {
                if (input.CurrentKg is decimal kg) await body.SetWeightAsync(today, kg, MeasurementSource.Manual);
            }
            catch (DiaryException ex) { return PlanEndpoints.Error(ex); }
            return Results.Ok(ToDto(p, (await body.LatestWeightAsync())?.Kg, today));
        });

        // Per-day budgets for the calendar: the fixed target plus the add-back share of that
        // day's active kcal (band + manual workouts).
        g.MapGet("/budget", async (DateOnly? start, int? days, BodyService body, ActivityService activity, CateringService catering) =>
        {
            var today = DateOnly.FromDateTime(DateTime.Today);
            await catering.EnsureAsync(today);
            var from = start ?? PlanEndpoints.StartOfWeek(today);
            var count = Math.Clamp(days ?? 7, 1, 60);
            var profile = await body.ProfileAsync();
            var weight = await body.LatestWeightAsync();
            if (profile is null || weight is null) return Results.Ok(new BudgetRangeDto(null, null, 50, []));
            var t = BodyService.Targets(profile, weight.Kg, today);
            var active = await activity.ActiveKcalAsync(from, from.AddDays(count - 1), t.Bmr);
            var list = Enumerable.Range(0, count).Select(i =>
            {
                var date = from.AddDays(i);
                var kcal = active.GetValueOrDefault(date);
                var budget = BodyService.Budget(t.Target, kcal, profile.ActivityAddBackPercent);
                return new DayBudgetDto(date, t.Target, kcal, budget - t.Target, budget);
            }).ToList();
            return Results.Ok(new BudgetRangeDto(t.Target, t.Protein, profile.ActivityAddBackPercent, list));
        });

        g.MapGet("/progress", async (int? days, BodyService body, ActivityService activity, CateringService catering) =>
        {
            var today = DateOnly.FromDateTime(DateTime.Today);
            await catering.EnsureAsync(today);
            var span = Math.Clamp(days ?? 84, 7, 730);
            var profile = await body.ProfileAsync();
            // Trend for the first visible point needs the week before it.
            var weights = await body.Weights().AsNoTracking()
                .Where(w => w.Date > today.AddDays(-span - BodyService.TrendDays))
                .OrderBy(w => w.Date).ToListAsync();
            var trend = BodyService.Trend(weights);
            var visible = trend.Where(p => p.Date > today.AddDays(-span)).ToList();
            var sourceByDate = weights.ToDictionary(w => w.Date, w => w.Source);
            var first = await body.Weights().AsNoTracking().OrderBy(w => w.Date).FirstOrDefaultAsync();

            decimal? trendNow = trend.Count > 0 ? trend[^1].Trend : null;
            var weekAgo = trend.Where(p => p.Date <= today.AddDays(-7)).Select(p => (decimal?)p.Trend).LastOrDefault();
            decimal? weekly = trendNow is decimal a && weekAgo is decimal b ? Math.Round(a - b, 2) : null;
            int? eta = profile is not null && trendNow is decimal tn && weekly is < 0 && tn > profile.GoalWeightKg
                ? (int)Math.Ceiling((tn - profile.GoalWeightKg) / -weekly.Value)
                : null;

            WeekSummaryDto? week = null;
            var streak = BodyService.Streak(await body.LoggedDaysAsync(today), today);
            if (profile is not null && trend.Count > 0)
            {
                var t = BodyService.Targets(profile, weights[^1].Kg, today);
                var monday = PlanEndpoints.StartOfWeek(today);
                var active = await activity.ActiveKcalAsync(monday, today, t.Bmr);
                var intake = await body.IntakeAsync(monday, today, t.Target, profile.ActivityAddBackPercent, active);
                var complete = intake.Where(d => d.Logged && d.Date < today).ToList();
                if (complete.Count == 0) complete = intake.Where(d => d.Logged).ToList();
                if (complete.Count > 0)
                {
                    var deficit = complete.Sum(d => d.Budget - d.Eaten);
                    week = new WeekSummaryDto(monday, today, complete.Count,
                        (int)Math.Round(complete.Average(d => d.Eaten)), (int)Math.Round(complete.Average(d => d.Budget)),
                        deficit, Math.Round((decimal)deficit / BodyService.KcalPerKg, 2));
                }
            }

            return Results.Ok(new ProgressDto(profile is not null, profile?.GoalWeightKg,
                weights.Count > 0 ? weights[^1].Kg : null, trendNow, weekly,
                trendNow is decimal tr && first is not null ? Math.Round(tr - first.Kg, 1) : null, eta,
                visible.Select(p => new WeightPointDto(p.Date, p.Kg, p.Trend, sourceByDate[p.Date].ToString().ToLowerInvariant())).ToList(),
                week, streak));
        });

        g.MapPut("/weights/{date}", async (DateOnly date, WeightInput input, BodyService body) =>
        {
            try
            {
                var w = await body.SetWeightAsync(date, input.Kg, MeasurementSource.Manual);
                return Results.Ok(new { w.Date, w.Kg });
            }
            catch (DiaryException ex) { return PlanEndpoints.Error(ex); }
        });

        g.MapDelete("/weights/{date}", async (DateOnly date, MiseDbContext db, BodyService body) =>
        {
            var w = await body.Weights().FirstOrDefaultAsync(x => x.Date == date);
            if (w is null) return Results.NotFound();
            db.WeightEntries.Remove(w);
            await db.SaveChangesAsync();
            return Results.NoContent();
        });

        // Diet catering: the average box day, counted as eaten on delivery days (CateringService).
        g.MapGet("/catering", async (CateringService catering) =>
            Results.Ok(ToDto(await catering.GetAsync())));

        g.MapPut("/catering", async (CateringInput input, CateringService catering, ContextExportService export) =>
        {
            var today = DateOnly.FromDateTime(DateTime.Today);
            try
            {
                var c = await catering.SaveAsync(input.Enabled, input.Kcal, input.Protein, input.Fat, input.Carbs,
                    input.Weekdays, input.StartDate ?? today, today);
                await export.ExportAsync();
                return Results.Ok(ToDto(c));
            }
            catch (DiaryException ex) { return PlanEndpoints.Error(ex); }
        });

        // A box on a day without delivery (weekend order), or one deleted by mistake.
        g.MapPost("/catering/log", async (CateringLogInput input, CateringService catering, ContextExportService export) =>
        {
            try
            {
                var entry = await catering.LogAsync(input.Date);
                await export.ExportAsync();
                return Results.Ok(Mapping.ToDto(entry, cooked: false));
            }
            catch (DiaryException ex) { return PlanEndpoints.Error(ex); }
        });

        return api;
    }

    private static CateringDto ToDto(Catering? c) => c is null
        ? new CateringDto(false, false, 0, null, null, null, 0b0011111, null)
        : new CateringDto(true, c.Enabled, c.Kcal, c.Protein, c.Fat, c.Carbs, c.Weekdays, c.StartDate);

    private static BodyDto ToDto(BodyProfile? p, decimal? currentKg, DateOnly today)
    {
        if (p is null)
            return new BodyDto(false, "female", today.Year - 30, 168, 0, "light", 0.5m, null, null, 50, currentKg,
                null, null, null, null, null);
        BodyTargets? t = currentKg is decimal kg ? BodyService.Targets(p, kg, today) : null;
        return new BodyDto(true, p.Sex.ToString().ToLowerInvariant(), p.BirthYear, p.HeightCm, p.GoalWeightKg,
            p.ActivityLevel.ToString().ToLowerInvariant(), p.PaceKgPerWeek, p.TargetKcalOverride, p.ProteinTargetOverride,
            p.ActivityAddBackPercent, currentKg, t?.Bmr, t?.Tdee, t?.Computed, t?.Target, t?.Protein);
    }
}
