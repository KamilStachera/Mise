using System.Collections.Concurrent;
using Microsoft.EntityFrameworkCore;
using Mise.Api.Data;

namespace Mise.Api.Services;

/// <summary>
/// Resolves who is calling (<see cref="People.ResolveAsync"/> → <see cref="Caller"/> + tenant) and
/// enforces access for everything under /api. A middleware (not a route-group filter) on purpose:
/// it must also cover /api/swagger and /api/images.
/// </summary>
public sealed class ApiAccessMiddleware(RequestDelegate next)
{
    /// <summary>
    /// Reads that stay privileged even when PUBLIC_HOUSEHOLD_ID is set. Anonymous visitors may
    /// only browse /api/recipes, /api/images (household-verified), redacted /api/plan, and /api/exercises.
    /// </summary>
    private static readonly PathString[] PrivatePrefixes =
    [
        new("/api/chat"),
        new("/api/import"),
        new("/api/diary"),
        new("/api/body"),
        new("/api/activity"),
        new("/api/training"),
        new("/api/context"),
        new("/api/swagger"),
        new("/api/household"),
        new("/api/keys"),
        new("/api/admin"),
        new("/api/pantry"),
        new("/api/shopping"),
        new("/api/supplies"),
        new("/api/preferences"),
        new("/api/profile"),
        new("/api/cooklog"),
        new("/api/plan/pending-cook"),
        new("/api/plan/shopping-preview"),
    ];

    /// <summary>Readable by anyone: the shared exercise catalog.</summary>
    private static readonly PathString[] OpenReadPrefixes =
    [
        new("/api/exercises"),
    ];

    /// <summary>Account-management endpoints forbidden to Sous turn tokens and internal system keys.</summary>
    private static readonly PathString[] InternalForbiddenPrefixes =
    [
        new("/api/keys"),
        new("/api/household/invites"),
        new("/api/household/people"),
        new("/api/activity/connection"),
        new("/api/admin"),
    ];

    private static readonly ConcurrentDictionary<string, DateTimeOffset> LastTouched = new();

    public async Task InvokeAsync(HttpContext ctx, AccessControl access, Caller caller, MiseDbContext db)
    {
        var path = ctx.Request.Path;
        // /api/hc/{token}: the phone's HC Webhook posts band/scale data; the endpoint itself
        // checks the secret token in the URL and picks the household from it.
        // /api/strava/webhook: Strava validates the subscription (GET) and posts events (POST);
        // events are only hints that StravaService re-checks with the athlete's own token.
        if (!path.StartsWithSegments("/api")
            || path.Equals("/api/health")
            || (path.StartsWithSegments("/api/hc") && HttpMethods.IsPost(ctx.Request.Method))
            || (path.Equals("/api/strava/webhook") && (HttpMethods.IsPost(ctx.Request.Method) || HttpMethods.IsGet(ctx.Request.Method))))
        {
            await next(ctx);
            return;
        }

        await People.ResolveAsync(ctx, db, access, caller, ctx.RequestAborted);
        await TouchAsync(db, caller, ctx.RequestAborted);

        if (caller.Kind == CallerKind.Blocked && !path.StartsWithSegments("/api/auth"))
        {
            ctx.Response.StatusCode = StatusCodes.Status403Forbidden;
            await ctx.Response.WriteAsJsonAsync(new
            {
                error = "To konto jest zablokowane — skontaktuj się z administratorem.",
                blocked = true,
            });
            return;
        }

        if (caller.Kind is CallerKind.SousToken or CallerKind.SystemKey
            && InternalForbiddenPrefixes.Any(p => path.StartsWithSegments(p)))
        {
            ctx.Response.StatusCode = StatusCodes.Status403Forbidden;
            await ctx.Response.WriteAsJsonAsync(new { error = "Ten token nie ma dostępu do ustawień konta." });
            return;
        }

        if (path.StartsWithSegments("/api/auth") || path.StartsWithSegments("/api/onboarding") || caller.IsPrivileged)
        {
            await next(ctx);
            return;
        }

        var method = ctx.Request.Method;
        var isRead = HttpMethods.IsGet(method) || HttpMethods.IsHead(method) || HttpMethods.IsOptions(method);
        if (isRead && OpenReadPrefixes.Any(p => path.StartsWithSegments(p)))
        {
            await next(ctx);
            return;
        }

        if (caller.Kind == CallerKind.Unlinked)
        {
            ctx.Response.StatusCode = StatusCodes.Status403Forbidden;
            await ctx.Response.WriteAsJsonAsync(new
            {
                error = "To konto nie należy jeszcze do żadnego domu — podaj kod zaproszenia.",
                needsOnboarding = true,
            });
            return;
        }

        if (isRead && caller.HouseholdId is not null && !PrivatePrefixes.Any(p => path.StartsWithSegments(p)))
        {
            await next(ctx);
            return;
        }

        ctx.Response.StatusCode = StatusCodes.Status401Unauthorized;
        await ctx.Response.WriteAsJsonAsync(new
        {
            error = caller.Kind == CallerKind.SystemKey
                ? "Klucz systemowy wymaga nagłówka X-Person z istniejącą osobą."
                : "Wymagane logowanie lub klucz API (nagłówek X-Api-Key).",
        });
    }

    /// <summary>
    /// Last-seen bookkeeping for the admin panel: the person behind a Google session or personal
    /// key, and the key itself — throttled in memory to at most once every 5 minutes per id so
    /// 99.9% of requests issue zero DB queries.
    /// </summary>
    private static async Task TouchAsync(MiseDbContext db, Caller caller, CancellationToken ct)
    {
        if (caller.Kind is not (CallerKind.Member or CallerKind.PersonalKey) || caller.Self is null) return;
        var now = DateTimeOffset.UtcNow;
        var cutoff = now.AddMinutes(-5);
        if (db.Database.IsRelational())
        {
            var personKey = $"p:{caller.Self.Id}";
            var touchPerson = !LastTouched.TryGetValue(personKey, out var lp) || lp < cutoff;
            var keyCacheKey = caller.ApiKeyId is Guid kid ? $"k:{kid}" : null;
            var touchKey = keyCacheKey is not null && (!LastTouched.TryGetValue(keyCacheKey, out var lk) || lk < cutoff);
            if (!touchPerson && !touchKey) return;

            if (touchPerson)
            {
                await db.People.Where(p => p.Id == caller.Self.Id && (p.LastSeenAt == null || p.LastSeenAt < cutoff))
                    .ExecuteUpdateAsync(s => s.SetProperty(p => p.LastSeenAt, now), ct);
                LastTouched[personKey] = now;
            }
            if (touchKey && caller.ApiKeyId is Guid id)
            {
                await db.ApiKeys.Where(k => k.Id == id && (k.LastUsedAt == null || k.LastUsedAt < cutoff))
                    .ExecuteUpdateAsync(s => s.SetProperty(k => k.LastUsedAt, now), ct);
                LastTouched[keyCacheKey!] = now;
            }
            return;
        }

        var person = await db.People.FirstOrDefaultAsync(p => p.Id == caller.Self.Id && (p.LastSeenAt == null || p.LastSeenAt < cutoff), ct);
        var key = caller.ApiKeyId is Guid gid
            ? await db.ApiKeys.FirstOrDefaultAsync(k => k.Id == gid && (k.LastUsedAt == null || k.LastUsedAt < cutoff), ct)
            : null;
        if (person is not null) person.LastSeenAt = now;
        if (key is not null) key.LastUsedAt = now;
        if (person is not null || key is not null)
        {
            await db.SaveChangesAsync(ct);
            db.ChangeTracker.Clear();
        }
    }
}
