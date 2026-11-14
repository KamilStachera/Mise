using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authentication.Google;
using Microsoft.EntityFrameworkCore;
using Mise.Api.Data;
using Mise.Api.Domain;
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
        g.MapGet("/me", async (Caller caller, MiseDbContext db, CancellationToken ct) =>
        {
            var publicHousehold = !caller.IsPrivileged && caller.HouseholdId is not null;
            if (caller.IsPrivileged && caller.Self is { } self)
            {
                var household = await db.Households.AsNoTracking().Where(h => h.Id == caller.HouseholdId)
                    .Select(h => new HouseholdDto(h.Id, h.Name, h.SousEnabled)).FirstOrDefaultAsync(ct);
                var dev = caller.Kind == CallerKind.DevBypass;
                return Results.Ok(new AuthMeDto(true,
                    caller.Email ?? (dev ? "dev@localhost" : null), caller.Name ?? (dev ? "Dev" : self.Name), caller.Picture,
                    self.Id, caller.People.Select(p => new PersonDto(p.Id, p.Name)).ToList(),
                    SignedIn: true, IsAdmin: caller.IsAdmin, Household: household,
                    Role: self.Role == HouseholdRole.Owner ? "owner" : "member", CanManage: caller.IsOwner));
            }
            if (caller.Kind == CallerKind.Blocked)
                return Results.Ok(new AuthMeDto(false, caller.Email, caller.Name, caller.Picture,
                    SignedIn: caller.Email is not null, Blocked: true));
            if (caller.Kind == CallerKind.Unlinked)
                return Results.Ok(new AuthMeDto(false, caller.Email, caller.Name, caller.Picture,
                    SignedIn: true, NeedsOnboarding: true, IsAdmin: caller.IsAdmin, PublicHousehold: publicHousehold));
            return Results.Ok(new AuthMeDto(false, null, null, null, PublicHousehold: publicHousehold));
        });

        g.MapPost("/logout", async (HttpContext ctx) =>
        {
            await ctx.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            return Results.NoContent();
        });

        return api;
    }
}
