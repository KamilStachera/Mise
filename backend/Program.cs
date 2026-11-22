using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.EntityFrameworkCore;
using Mise.Api.Data;
using Mise.Api.Features;
using Mise.Api.Services;
using Mise.Api.Services.AiChat;
using Mise.Api.Services.Strava;
using Mise.Api.Services.Training;

var builder = WebApplication.CreateBuilder(args);

var connectionString = builder.Configuration.GetConnectionString("Default")
    ?? "Host=localhost;Port=5432;Database=mise;Username=mise;Password=mise_dev_password";
builder.Services.AddDbContext<MiseDbContext>(o => o.UseNpgsql(connectionString));

builder.Services.AddScoped<IngredientMatcher>();
builder.Services.AddScoped<RecipeIngredientNormalizer>();
builder.Services.AddScoped<ShoppingService>();
builder.Services.AddScoped<SupplyService>();
builder.Services.AddHttpContextAccessor();
builder.Services.AddTenancy();
builder.Services.AddScoped<HouseholdProvisioner>();
builder.Services.AddHouseholdRateLimits();
builder.Services.AddScoped<DiaryService>();
builder.Services.AddScoped<MealSlots>();
builder.Services.AddScoped<BodyService>();
builder.Services.AddScoped<ActivityService>();
// Watch workouts via Strava (Garmin, Polar…): on only with STRAVA_CLIENT_ID/SECRET.
builder.Services.AddSingleton(StravaOptions.From(builder.Configuration));
builder.Services.AddHttpClient<StravaClient>(c => c.Timeout = TimeSpan.FromSeconds(20));
builder.Services.AddScoped<StravaService>();
builder.Services.AddSingleton<StravaEventQueue>();
builder.Services.AddHostedService<StravaWorker>();
builder.Services.AddScoped<CateringService>();
builder.Services.AddMemoryCache();
builder.Services.AddScoped<OpenFoodFacts>();
builder.Services.AddScoped<StockReliability>();
builder.Services.AddSingleton<CookbookMarkdownBuilder>();
builder.Services.AddSingleton<RecipeImageStore>();
builder.Services.AddSingleton<ChatImageStore>();
builder.Services.AddSingleton<ContextExportQueue>();
builder.Services.AddHostedService<ContextExportWorker>();
builder.Services.AddScoped<ContextExportService>();
builder.Services.AddScoped<HouseholdExportService>();
builder.Services.AddHttpClient();
builder.Services.AddSingleton<Mise.Api.Services.Import.SafeWebFetcher>();
builder.Services.AddScoped<Mise.Api.Services.Import.ImportService>();
builder.Services.AddSingleton<ExerciseImages>();
builder.Services.AddSingleton<YouTubeVerifier>();
builder.Services.AddScoped<TrainingSessionService>();
// Background Polish descriptions + demo videos for the exercise catalog (GPT via Sous).
builder.Services.AddSingleton<EnrichmentState>();
builder.Services.AddSingleton<ISousJobs, SousJobs>();
builder.Services.AddScoped<ExerciseEnrichment>();
builder.Services.AddScoped<RecipeNutritionEstimator>();
builder.Services.AddHostedService<ExerciseEnrichmentWorker>();
builder.Services.AddScoped<IChatProvider>(sp =>
    ChatProviderFactory.Create(sp.GetRequiredService<IConfiguration>(),
        sp.GetRequiredService<IHttpClientFactory>(),
        sp.GetRequiredService<AccessControl>()));

builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(c =>
    c.SwaggerDoc("v1", new() { Title = "Pichci API", Version = "v1" }));

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
        // Any Google account may sign in; one that belongs to no household only reaches
        // /api/auth and /api/onboarding (invite code) until it joins one.
        o.ClaimActions.MapJsonKey("picture", "picture");
    });
}

var app = builder.Build();

var accessControl = app.Services.GetRequiredService<AccessControl>();
var publicBase = app.Configuration["PUBLIC_API_BASE"] ?? "";
if (accessControl.DevBypass
    && publicBase.StartsWith("https://", StringComparison.OrdinalIgnoreCase)
    && !app.Configuration.GetValue("ALLOW_INSECURE_DEV_BYPASS", false))
{
    throw new InvalidOperationException(
        "Refusing to start with AUTH_DEV_BYPASS=true while PUBLIC_API_BASE is https://. Set AUTH_DEV_BYPASS=false.");
}
if (!accessControl.SystemKeyEnabled && !accessControl.DevBypass)
    app.Logger.LogWarning("MISE_API_KEY is not set — internal Sous authentication is disabled (fail closed).");

await DbInitializer.InitAsync(app.Services, app.Logger);

// nginx + cloudflared terminate TLS (2 proxy hops); without ForwardLimit = 2 RemoteIpAddress
// would collapse to cloudflared's container IP for every internet caller.
var forwarded = new ForwardedHeadersOptions
{
    ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto,
    ForwardLimit = 2,
};
forwarded.KnownIPNetworks.Clear();
forwarded.KnownProxies.Clear();
app.UseForwardedHeaders(forwarded);

app.UseAuthentication();
// Before swagger and endpoints on purpose — the guard must cover them too.
app.UseMiddleware<ApiAccessMiddleware>();
app.UseRateLimiter();

// Swagger only in Development unless explicitly opted in via ENABLE_SWAGGER=true.
if (app.Environment.IsDevelopment() || app.Configuration.GetValue("ENABLE_SWAGGER", false))
{
    app.UseSwagger(c => c.RouteTemplate = "api/swagger/{documentName}/swagger.json");
    app.UseSwaggerUI(c =>
    {
        c.SwaggerEndpoint("/api/swagger/v1/swagger.json", "Pichci API v1");
        c.RoutePrefix = "api/swagger";
    });
}

app.MapGet("/api/health", async (MiseDbContext db, CancellationToken ct) =>
    await db.Database.CanConnectAsync(ct)
        ? Results.Ok(new { status = "ok" })
        : Results.Json(new { status = "unhealthy" }, statusCode: StatusCodes.Status503ServiceUnavailable));

var api = app.MapGroup("/api");
api.MapImages();
api.MapAuth();
api.MapHouseholds();
api.MapAdmin();
api.MapKeys();
api.MapRecipes();
api.MapSharedRecipes();
api.MapPantry();
api.MapShopping();
api.MapSupplies();
api.MapPreferences();
api.MapProfileQuestionnaire();
api.MapCookLog();
api.MapPlan();
api.MapDiary();
api.MapMeals();
api.MapBody();
api.MapActivity();
api.MapStrava();
api.MapExercises();
api.MapTraining();
api.MapContext();
api.MapChat();
api.MapImport();

app.Run();
