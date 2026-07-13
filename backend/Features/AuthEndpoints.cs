using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authentication.Google;
using Mise.Api.Services;

namespace Mise.Api.Features;

public static class AuthEndpoints
{
    public static RouteGroupBuilder MapAuth(this RouteGroupBuilder api)
    {
        var g = api.MapGroup("/auth").WithTags("Auth");

        // Full-page navigation target: challenges Google, then lands back on returnUrl.
        g.MapGet("/login", (string? returnUrl, AccessControl access) =>
        {
            if (!access.GoogleConfigured)
                return Results.Json(
                    new { error = "Logowanie Google nie jest skonfigurowane na tym serwerze." },
                    statusCode: StatusCodes.Status503ServiceUnavailable);

            // Local paths only — no open redirect.
            var target = returnUrl is ['/', ..] && !returnUrl.StartsWith("//") && !returnUrl.StartsWith("/\\")
                ? returnUrl
                : "/";
            return Results.Challenge(
                new AuthenticationProperties { RedirectUri = target },
                [GoogleDefaults.AuthenticationScheme]);
        });

        // Always 200 — the frontend derives read-only mode from `authenticated`.
        g.MapGet("/me", (HttpContext ctx, AccessControl access) =>
        {
            if (access.DevBypass)
                return Results.Ok(new AuthMeDto(true, "dev@localhost", "Dev", null));

            var user = ctx.User;
            var email = user.FindFirstValue(ClaimTypes.Email);
            if (user.Identity?.IsAuthenticated == true && access.IsAllowedEmail(email))
                return Results.Ok(new AuthMeDto(true, email,
                    user.FindFirstValue(ClaimTypes.Name), user.FindFirstValue("picture")));

            return Results.Ok(new AuthMeDto(false, null, null, null));
        });

        g.MapPost("/logout", async (HttpContext ctx) =>
        {
            await ctx.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            return Results.NoContent();
        });

        return api;
    }
}
