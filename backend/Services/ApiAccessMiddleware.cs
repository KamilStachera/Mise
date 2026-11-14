using Microsoft.EntityFrameworkCore;
using Mise.Api.Data;

namespace Mise.Api.Services;

/// <summary>
/// Resolves who is calling (<see cref="People.ResolveAsync"/> → <see cref="Caller"/> + tenant) and
/// enforces access for everything under /api. A middleware (not a route-group filter) on purpose:
/// it must also cover the /api/images static files and /api/swagger, which are registered outside
/// the endpoint group.
/// </summary>
public sealed class ApiAccessMiddleware(RequestDelegate next)
{
    /// <summary>Reads that stay privileged: chat and imported PDFs, the food diary and training are personal, context/status+connect leak host paths, swagger advertises the write surface, households/keys are account data.</summary>
    private static readonly PathString[] PrivatePrefixes =
    [
        new("/api/chat"),
        new("/api/import"),
        new("/api/diary"),
        new("/api/body"),
        new("/api/activity"),
        new("/api/training"),
        new("/api/context/status"),
        new("/api/context/connect"),
        new("/api/swagger"),
        new("/api/household"),
        new("/api/keys"),
        new("/api/admin"),
    ];

    /// <summary>Readable by anyone: photos have unguessable names, the exercise catalog is shared.</summary>
    private static readonly PathString[] OpenReadPrefixes =
    [
        new("/api/images"),
        new("/api/exercises"),
    ];

    public async Task InvokeAsync(HttpContext ctx, AccessControl access, Caller caller, MiseDbContext db)
    {
        var path = ctx.Request.Path;
        // /api/hc/{token}: the phone's HC Webhook posts band/scale data; the endpoint itself
        // checks the secret token in the URL and picks the household from it.
        if (!path.StartsWithSegments("/api")
            || path.Equals("/api/health")
            || (path.StartsWithSegments("/api/hc") && HttpMethods.IsPost(ctx.Request.Method)))
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
        if (isRead && caller.HouseholdId is not null && !PrivatePrefixes.Any(p => path.StartsWithSegments(p)))
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
    /// key, and the key itself — at most every few minutes each, so most requests write nothing.
    /// </summary>
    private static async Task TouchAsync(MiseDbContext db, Caller caller, CancellationToken ct)
    {
        if (caller.Kind is not (CallerKind.Member or CallerKind.PersonalKey) || caller.Self is null) return;
        var now = DateTimeOffset.UtcNow;
        var cutoff = now.AddMinutes(-5);
        var person = await db.People.FirstOrDefaultAsync(p => p.Id == caller.Self.Id
            && (p.LastSeenAt == null || p.LastSeenAt < cutoff), ct);
        var key = caller.ApiKeyId is Guid id
            ? await db.ApiKeys.FirstOrDefaultAsync(k => k.Id == id && (k.LastUsedAt == null || k.LastUsedAt < cutoff), ct)
            : null;
        if (person is null && key is null) return;
        if (person is not null) person.LastSeenAt = now;
        if (key is not null) key.LastUsedAt = now;
        await db.SaveChangesAsync(ct);
        db.ChangeTracker.Clear();
    }
}
