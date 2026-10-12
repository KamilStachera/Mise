namespace Mise.Api.Services;

/// <summary>
/// Enforces the anonymous-read-only rule for everything under /api. A middleware
/// (not a route-group filter) on purpose: it must also cover the /api/images
/// static files and /api/swagger, which are registered outside the endpoint group.
/// </summary>
public sealed class ApiAccessMiddleware(RequestDelegate next)
{
    /// <summary>Reads that stay privileged: chat and the food diary are personal, context/status+connect leak host paths, swagger advertises the write surface.</summary>
    private static readonly PathString[] PrivatePrefixes =
    [
        new("/api/chat"),
        new("/api/diary"),
        new("/api/body"),
        new("/api/activity"),
        new("/api/context/status"),
        new("/api/context/connect"),
        new("/api/swagger"),
    ];

    public async Task InvokeAsync(HttpContext ctx, AccessControl access)
    {
        var path = ctx.Request.Path;
        // /api/hc/{token}: the phone's HC Webhook posts band/scale data; the endpoint itself
        // checks the secret token in the URL (an app on a phone can't do a Google login).
        if (!path.StartsWithSegments("/api")
            || path.StartsWithSegments("/api/auth")
            || path.Equals("/api/health")
            || (path.StartsWithSegments("/api/hc") && HttpMethods.IsPost(ctx.Request.Method)))
        {
            await next(ctx);
            return;
        }

        if (access.IsPrivileged(ctx))
        {
            await next(ctx);
            return;
        }

        var method = ctx.Request.Method;
        var isRead = HttpMethods.IsGet(method) || HttpMethods.IsHead(method) || HttpMethods.IsOptions(method);
        if (isRead && !PrivatePrefixes.Any(p => path.StartsWithSegments(p)))
        {
            await next(ctx);
            return;
        }

        ctx.Response.StatusCode = StatusCodes.Status401Unauthorized;
        await ctx.Response.WriteAsJsonAsync(new
        {
            error = "Wymagane logowanie lub klucz API (nagłówek X-Api-Key).",
        });
    }
}
