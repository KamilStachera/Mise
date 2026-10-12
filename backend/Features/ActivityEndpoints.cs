using Microsoft.EntityFrameworkCore;
using Mise.Api.Data;
using Mise.Api.Domain;
using Mise.Api.Services;

namespace Mise.Api.Features;

/// <summary>
/// Band/scale sync and workouts. <c>POST /hc/{token}</c> is what the phone's HC Webhook app
/// calls — it authenticates by the URL token, so ApiAccessMiddleware lets it through; the
/// rest (/activity) is private like the diary.
/// </summary>
public static class ActivityEndpoints
{
    public static RouteGroupBuilder MapActivity(this RouteGroupBuilder api)
    {
        api.MapPost("/hc/{token}", async (string token, HcPayload payload, ActivityService activity) =>
        {
            if (await activity.AuthorizeAsync(token) is not { } sync) return Results.NotFound();
            var r = await activity.IngestAsync(sync, payload);
            return Results.Ok(new { ok = true, energy = r.Energy, workouts = r.Workouts, weights = r.Weights });
        }).WithTags("Activity");

        var g = api.MapGroup("/activity").WithTags("Activity");

        g.MapGet("/", async (int? days, MiseDbContext db, ActivityService activity, BodyService body) =>
        {
            var today = DateOnly.FromDateTime(DateTime.Today);
            var count = Math.Clamp(days ?? 7, 1, 60);
            var (bmr, addBack) = await BmrAndAddBackAsync(body, today);
            var list = await activity.DaysAsync(today.AddDays(-count + 1), today, bmr);
            var sync = await db.HealthSyncs.AsNoTracking().FirstOrDefaultAsync(s => s.Id == 1);
            return Results.Ok(new ActivityDto(
                StateString(ActivityService.State(sync, DateTimeOffset.UtcNow)), sync?.LastSyncAt, addBack,
                list.OrderByDescending(d => d.Date).Select(d => new ActivityDayDto(d.Date, d.ActiveKcal,
                    BodyService.Budget(0, d.ActiveKcal, addBack),
                    d.Workouts.Select(w => ToDto(w.Workout, w.Kcal)).ToList())).ToList()));
        });

        // Creates the token on first use, so opening the setup screen is enough.
        g.MapGet("/connection", async (ActivityService activity) =>
        {
            var sync = await activity.SyncAsync();
            return Results.Ok(new HealthConnectionDto(sync.Token, StateString(ActivityService.State(sync, DateTimeOffset.UtcNow)), sync.LastSyncAt));
        });

        g.MapPost("/connection/rotate", async (ActivityService activity) =>
        {
            var sync = await activity.SyncAsync(rotate: true);
            return Results.Ok(new HealthConnectionDto(sync.Token, StateString(SyncState.None), null));
        });

        g.MapPost("/workouts", async (WorkoutInput input, MiseDbContext db) =>
        {
            if (string.IsNullOrWhiteSpace(input.Type)) return Results.BadRequest(new { error = "Podaj rodzaj treningu." });
            if (input.Minutes is < 1 or > 600) return Results.BadRequest(new { error = "Czas od 1 do 600 minut." });
            if (input.Kcal is < 0 or > 5000) return Results.BadRequest(new { error = "Kcal poza zakresem." });
            DateTimeOffset? started = null;
            if (TimeOnly.TryParse(input.Time, out var time))
            {
                var local = input.Date.ToDateTime(time);
                started = new DateTimeOffset(local, TimeZoneInfo.Local.GetUtcOffset(local)).ToUniversalTime();
            }
            var w = new Workout
            {
                Date = input.Date,
                StartedAt = started,
                Minutes = input.Minutes,
                Kcal = input.Kcal,
                Type = input.Type.Trim(),
                Source = MeasurementSource.Manual,
            };
            db.Workouts.Add(w);
            await db.SaveChangesAsync();
            return Results.Ok(ToDto(w, w.Kcal));
        });

        g.MapDelete("/workouts/{id:guid}", async (Guid id, MiseDbContext db) =>
        {
            var w = await db.Workouts.FirstOrDefaultAsync(x => x.Id == id);
            if (w is null) return Results.NotFound();
            db.Workouts.Remove(w);
            await db.SaveChangesAsync();
            return Results.NoContent();
        });

        return api;
    }

    /// <summary>BMR (for the Total − BMR fallback) and the add-back share; defaults when no profile yet.</summary>
    public static async Task<(int? Bmr, int AddBack)> BmrAndAddBackAsync(BodyService body, DateOnly today)
    {
        var profile = await body.ProfileAsync();
        var weight = await body.LatestWeightAsync();
        if (profile is null) return (null, 50);
        return (weight is null ? null : BodyService.Targets(profile, weight.Kg, today).Bmr, profile.ActivityAddBackPercent);
    }

    private static string StateString(SyncState s) => s.ToString().ToLowerInvariant();

    private static WorkoutDto ToDto(Workout w, int? kcal) =>
        new(w.Id, w.Date, w.StartedAt, w.Minutes, kcal, w.Type, w.Source == MeasurementSource.Manual ? "manual" : "band");
}
