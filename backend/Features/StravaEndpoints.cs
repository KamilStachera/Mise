using Mise.Api.Services;
using Mise.Api.Services.Strava;

namespace Mise.Api.Features;

/// <summary>
/// Watch workouts via Strava. <c>/strava/webhook</c> is Strava's (public, like <c>/hc/{token}</c>:
/// ApiAccessMiddleware lets it through; events are only hints, see <see cref="StravaService"/>).
/// <c>/activity/strava/*</c> is private like the rest of /activity and acts for the acting person.
/// </summary>
public static class StravaEndpoints
{
    public static RouteGroupBuilder MapStrava(this RouteGroupBuilder api)
    {
        // Subscription validation: echo hub.challenge when the verify token is ours.
        api.MapGet("/strava/webhook", (HttpRequest req, StravaOptions options) =>
        {
            var q = req.Query;
            if (!options.Configured || q["hub.mode"] != "subscribe" || q["hub.verify_token"] != options.VerifyToken)
                return Results.StatusCode(StatusCodes.Status403Forbidden);
            return Results.Json(new Dictionary<string, string> { ["hub.challenge"] = q["hub.challenge"].ToString() });
        }).WithTags("Strava");

        // Strava wants a 200 within 2 s and retries otherwise: queue and answer.
        api.MapPost("/strava/webhook", (StravaEvent e, StravaOptions options, StravaEventQueue queue) =>
        {
            if (options.Configured) queue.TryEnqueue(e);
            return Results.Ok();
        }).WithTags("Strava");

        var g = api.MapGroup("/activity/strava").WithTags("Activity");

        g.MapGet("/", async (StravaService strava, CancellationToken ct) => Results.Ok(await strava.StatusAsync(ct)));

        // The page navigates to the returned url (Strava's consent screen), which comes back to /callback.
        g.MapPost("/connect", (HttpRequest req, StravaService strava, Caller caller) =>
        {
            if (!strava.Options.Configured)
                return Results.Json(new { error = "Strava nie jest skonfigurowana na tym serwerze." }, statusCode: StatusCodes.Status503ServiceUnavailable);
            if (caller.HouseholdId is not int household)
                return Results.Unauthorized();
            return Results.Ok(new { url = strava.AuthorizeUrl(CallbackUri(req), household) });
        });

        // Strava redirects the browser here (cookie session rides the top-level GET).
        g.MapGet("/callback", async (string? code, string? scope, string? state, string? error,
            StravaService strava, Caller caller, ILogger<StravaService> log, CancellationToken ct) =>
        {
            static IResult Back(string outcome) => Results.Redirect($"/plan/aktywnosc?strava={outcome}");

            // The state names the person who clicked "Połącz"; the browser coming back must be
            // allowed to act for them (same household, a person this caller can pick).
            var s = strava.ReadState(state);
            if (s is null || s.HouseholdId != caller.HouseholdId || caller.People.All(p => p.Id != s.PersonId))
                return Back("error");
            if (!string.IsNullOrEmpty(error) || string.IsNullOrEmpty(code))
                return Back("denied");
            try
            {
                return Back(await strava.ConnectAsync(s.PersonId, code, scope, ct) switch
                {
                    StravaConnectOutcome.Connected => "connected",
                    StravaConnectOutcome.MissingScope => "scope",
                    _ => "taken",
                });
            }
            catch (Exception e) when (e is StravaApiException or HttpRequestException or TaskCanceledException)
            {
                log.LogWarning(e, "Strava connect for person {Person} failed", s.PersonId);
                return Back("error");
            }
        });

        g.MapPost("/sync", async (StravaService strava, CancellationToken ct) =>
        {
            if (await strava.ConnectionAsync(ct) is not { } conn) return Results.NotFound(new { error = "Strava nie jest połączona." });
            try
            {
                var imported = await strava.SyncAsync(conn, StravaService.BackfillDays, refreshKnown: true, ct);
                return Results.Ok(new { imported, connected = (await strava.ConnectionAsync(ct)) is not null });
            }
            catch (Exception e) when (e is StravaApiException or HttpRequestException or TaskCanceledException)
            {
                return Results.Json(new { error = "Strava nie odpowiada — spróbuj za chwilę." }, statusCode: StatusCodes.Status502BadGateway);
            }
        });

        g.MapDelete("/", async (StravaService strava, CancellationToken ct) =>
            await strava.DisconnectAsync(ct) ? Results.NoContent() : Results.NotFound());

        return api;
    }

    /// <summary>Behind nginx/cloudflared the forwarded proto + host make this the public https URL.</summary>
    private static string CallbackUri(HttpRequest req) => $"{req.Scheme}://{req.Host}{req.PathBase}/api/activity/strava/callback";
}
