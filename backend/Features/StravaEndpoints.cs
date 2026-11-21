using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
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
    private const string NonceCookie = "mise_strava_nonce";
    private static readonly TimeSpan SyncCooldown = TimeSpan.FromMinutes(2);
    private static readonly ConcurrentDictionary<int, DateTimeOffset> LastManualSync = new();

    public static RouteGroupBuilder MapStrava(this RouteGroupBuilder api)
    {
        // Subscription validation: echo hub.challenge when the verify token is ours.
        api.MapGet("/strava/webhook", (HttpRequest req, StravaOptions options) =>
        {
            var q = req.Query;
            var got = q["hub.verify_token"].ToString();
            var ok = options.Configured && q["hub.mode"] == "subscribe"
                && got.Length == options.VerifyToken.Length
                && CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(got), Encoding.UTF8.GetBytes(options.VerifyToken));
            if (!ok) return Results.StatusCode(StatusCodes.Status403Forbidden);
            return Results.Json(new Dictionary<string, string> { ["hub.challenge"] = q["hub.challenge"].ToString() });
        }).WithTags("Strava");

        // Strava wants a 200 within 2 s and retries otherwise: validate subscription_id, queue and answer.
        api.MapPost("/strava/webhook", (StravaEvent e, StravaOptions options, StravaEventQueue queue) =>
        {
            if (options.Configured && (queue.SubscriptionId == 0 || e.SubscriptionId == queue.SubscriptionId))
                queue.TryEnqueue(e);
            return Results.Ok();
        }).WithTags("Strava").RequireRateLimiting(HouseholdEndpoints.WebhookRateLimit);

        var g = api.MapGroup("/activity/strava").WithTags("Activity");

        g.MapGet("/", async (StravaService strava, CancellationToken ct) => Results.Ok(await strava.StatusAsync(ct)));

        // The page navigates to the returned url (Strava's consent screen), which comes back to /callback.
        g.MapPost("/connect", (HttpContext ctx, StravaService strava, Caller caller, IConfiguration config) =>
        {
            if (!strava.Options.Configured)
                return Results.Json(new { error = "Strava nie jest skonfigurowana na tym serwerze." }, statusCode: StatusCodes.Status503ServiceUnavailable);
            if (caller.HouseholdId is not int household)
                return Results.Unauthorized();
            var (url, nonce) = strava.AuthorizeStart(CallbackUri(ctx.Request, config), household);
            ctx.Response.Cookies.Append(NonceCookie, nonce, new CookieOptions
            {
                HttpOnly = true,
                SameSite = SameSiteMode.Lax,
                Secure = ctx.Request.IsHttps,
                MaxAge = TimeSpan.FromMinutes(15),
                Path = "/api/activity/strava",
            });
            return Results.Ok(new { url });
        });

        // Strava redirects the browser here (cookie session + nonce cookie ride the top-level GET).
        g.MapGet("/callback", async (HttpContext ctx, string? code, string? scope, string? state, string? error,
            StravaService strava, Caller caller, ILogger<StravaService> log, CancellationToken ct) =>
        {
            static IResult Back(string outcome) => Results.Redirect($"/plan/aktywnosc?strava={outcome}");

            var expectedNonce = ctx.Request.Cookies[NonceCookie];
            ctx.Response.Cookies.Delete(NonceCookie, new CookieOptions { Path = "/api/activity/strava" });

            // The state names the person who clicked "Połącz"; verify browser-bound nonce and household membership.
            var s = strava.ReadState(state);
            var nonceOk = !string.IsNullOrEmpty(expectedNonce) && s is not null
                && expectedNonce.Length == s.Nonce.Length
                && CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(expectedNonce), Encoding.UTF8.GetBytes(s.Nonce));
            if (s is null || !nonceOk || s.HouseholdId != caller.HouseholdId || caller.People.All(p => p.Id != s.PersonId))
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

        g.MapPost("/sync", async (StravaService strava, PersonScope person, CancellationToken ct) =>
        {
            var now = DateTimeOffset.UtcNow;
            if (LastManualSync.TryGetValue(person.Id, out var prev) && now - prev < SyncCooldown)
                return Results.Json(new { error = "Poczekaj chwilę przed kolejną synchronizacją ze Stravą." },
                    statusCode: StatusCodes.Status429TooManyRequests);
            if (await strava.ConnectionAsync(ct) is not { } conn) return Results.NotFound(new { error = "Strava nie jest połączona." });
            LastManualSync[person.Id] = now;
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

    /// <summary>Prefer PUBLIC_API_BASE when configured (https); fall back to request host for local dev.</summary>
    private static string CallbackUri(HttpRequest req, IConfiguration config)
    {
        if (config["PUBLIC_API_BASE"] is { Length: > 0 } pub
            && pub.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
            return pub.TrimEnd('/') + "/activity/strava/callback";
        return $"{req.Scheme}://{req.Host}{req.PathBase}/api/activity/strava/callback";
    }
}
