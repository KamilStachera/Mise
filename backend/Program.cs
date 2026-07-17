using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.FileProviders;
using Mise.Api.Data;
using Mise.Api.Features;
using Mise.Api.Services;
using Mise.Api.Services.AiChat;

var builder = WebApplication.CreateBuilder(args);

var connectionString = builder.Configuration.GetConnectionString("Default")
    ?? "Host=localhost;Port=5432;Database=mise;Username=mise;Password=mise_dev_password";
builder.Services.AddDbContext<MiseDbContext>(o => o.UseNpgsql(connectionString));

builder.Services.AddScoped<IngredientMatcher>();
builder.Services.AddScoped<RecipeIngredientNormalizer>();
builder.Services.AddScoped<ShoppingService>();
builder.Services.AddSingleton<CookbookMarkdownBuilder>();
builder.Services.AddSingleton<RecipeImageStore>();
builder.Services.AddScoped<ContextExportService>();
builder.Services.AddHttpClient();
builder.Services.AddScoped<IChatProvider>(sp =>
    ChatProviderFactory.Create(sp.GetRequiredService<IConfiguration>(), sp.GetRequiredService<IHttpClientFactory>()));

builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

builder.Services.AddSingleton<AccessControl>();

// Cookie session survives container rebuilds only if the keys do (mise-keys volume).
if (builder.Configuration["KeysDir"] is string keysDir && !string.IsNullOrWhiteSpace(keysDir))
    builder.Services.AddDataProtection().PersistKeysToFileSystem(new DirectoryInfo(keysDir));

var auth = builder.Services
    .AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme)
    .AddCookie(o =>
    {
        o.Cookie.Name = "mise_auth";
        o.Cookie.HttpOnly = true;
        // Lax = the cookie rides the OAuth redirect but not cross-site POSTs (CSRF cover).
        o.Cookie.SameSite = SameSiteMode.Lax;
        // Secure behind the tunnel (X-Forwarded-Proto → https), plain http on localhost.
        o.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;
        o.ExpireTimeSpan = TimeSpan.FromDays(30);
        o.SlidingExpiration = true;
        // JSON API: emit status codes instead of redirecting to a login page.
        o.Events.OnRedirectToLogin = c => { c.Response.StatusCode = 401; return Task.CompletedTask; };
        o.Events.OnRedirectToAccessDenied = c => { c.Response.StatusCode = 403; return Task.CompletedTask; };
    });
// Google only when configured, so a bare dev stack still boots (login then 503s).
if (!string.IsNullOrWhiteSpace(builder.Configuration["Auth:Google:ClientId"]))
{
    auth.AddGoogle(o =>
    {
        o.ClientId = builder.Configuration["Auth:Google:ClientId"]!;
        o.ClientSecret = builder.Configuration["Auth:Google:ClientSecret"] ?? "";
        // Under /api so both nginx and the Vite dev proxy route it to the backend.
        o.CallbackPath = "/api/auth/google-callback";
        o.CorrelationCookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;
        o.ClaimActions.MapJsonKey("picture", "picture");
        o.Events.OnTicketReceived = ctx =>
        {
            var access = ctx.HttpContext.RequestServices.GetRequiredService<AccessControl>();
            var email = ctx.Principal?.FindFirstValue(ClaimTypes.Email);
            if (!access.IsAllowedEmail(email))
            {
                // Not whitelisted: no cookie, bounce back with a flag the SPA turns into a toast.
                ctx.Response.Redirect("/?auth=denied");
                ctx.HandleResponse();
            }
            return Task.CompletedTask;
        };
    });
}

var app = builder.Build();

var accessControl = app.Services.GetRequiredService<AccessControl>();
if (!accessControl.ApiKeyEnabled && !accessControl.DevBypass)
    app.Logger.LogWarning("MISE_API_KEY is not set — agent/MCP writes are disabled (fail closed).");

await DbInitializer.InitAsync(app.Services, app.Logger);

// nginx/cloudflared terminate TLS; without the forwarded proto Google would get an
// http:// redirect_uri and reject it. Docker-network proxies aren't in the default
// allowlist, hence the Clear() calls.
var forwarded = new ForwardedHeadersOptions
{
    ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto,
};
forwarded.KnownNetworks.Clear();
forwarded.KnownProxies.Clear();
app.UseForwardedHeaders(forwarded);

app.UseAuthentication();
// Before static files and swagger on purpose — the guard must cover them too.
app.UseMiddleware<ApiAccessMiddleware>();

// Recipe photos live outside wwwroot (a docker volume in production).
app.UseStaticFiles(new StaticFileOptions
{
    FileProvider = new PhysicalFileProvider(app.Services.GetRequiredService<RecipeImageStore>().Root),
    RequestPath = "/api/images",
});

app.UseSwagger(c => c.RouteTemplate = "api/swagger/{documentName}/swagger.json");
app.UseSwaggerUI(c =>
{
    c.SwaggerEndpoint("/api/swagger/v1/swagger.json", "Mise API v1");
    c.RoutePrefix = "api/swagger";
});

app.MapGet("/api/health", () => Results.Ok(new { status = "ok" }));

var api = app.MapGroup("/api");
api.MapAuth();
api.MapRecipes();
api.MapPantry();
api.MapShopping();
api.MapPreferences();
api.MapProfileQuestionnaire();
api.MapCookLog();
api.MapPlan();
api.MapContext();
api.MapChat();

app.Run();
