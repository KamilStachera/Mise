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
builder.Services.AddScoped<ShoppingService>();
builder.Services.AddSingleton<CookbookMarkdownBuilder>();
builder.Services.AddSingleton<RecipeImageStore>();
builder.Services.AddScoped<ContextExportService>();
builder.Services.AddHttpClient();
builder.Services.AddScoped<IChatProvider>(sp =>
    ChatProviderFactory.Create(sp.GetRequiredService<IConfiguration>(), sp.GetRequiredService<IHttpClientFactory>()));

builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();
builder.Services.AddCors(o => o.AddDefaultPolicy(p =>
    p.AllowAnyOrigin().AllowAnyHeader().AllowAnyMethod()));

var app = builder.Build();

await DbInitializer.InitAsync(app.Services, app.Logger);

app.UseCors();

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
