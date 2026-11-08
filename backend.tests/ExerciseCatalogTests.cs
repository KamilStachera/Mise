using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Mise.Api.Data;
using Mise.Api.Domain;
using Mise.Api.Features;
using Mise.Api.Services;
using Mise.Api.Services.Training;
using Xunit;

namespace Mise.Api.Tests;

public class ExerciseCatalogTests
{
    private const string Upstream = """
        [
          { "name": "Dumbbell Lunges", "force": "push", "level": "beginner", "mechanic": "compound",
            "equipment": "dumbbell", "primaryMuscles": ["quadriceps"], "secondaryMuscles": ["glutes", "hamstrings", "calves"],
            "instructions": ["Stand with dumbbells.", "Step forward."], "category": "strength",
            "images": ["Dumbbell_Lunges/0.jpg", "Dumbbell_Lunges/1.jpg"], "id": "Dumbbell_Lunges" },
          { "name": "Plank", "force": "static", "level": "beginner", "mechanic": "isolation",
            "equipment": "body only", "primaryMuscles": ["abdominals"], "secondaryMuscles": [],
            "instructions": ["Hold."], "category": "strength", "images": ["Plank/0.jpg"], "id": "Plank" },
          { "name": "Atlas Stones", "force": "pull", "level": "expert", "mechanic": "compound",
            "equipment": "other", "primaryMuscles": ["lower back"], "secondaryMuscles": ["middle back"],
            "instructions": [], "category": "strongman", "images": [], "id": "Atlas_Stones" },
          { "name": "EZ Curl", "force": "pull", "level": "beginner", "mechanic": "isolation",
            "equipment": "e-z curl bar", "primaryMuscles": ["biceps"], "secondaryMuscles": [],
            "instructions": [], "category": "strength", "images": ["../../etc/passwd"], "id": "EZ_Curl" },
          { "name": "Kettlebell Swing", "force": null, "level": "intermediate", "mechanic": null,
            "equipment": "kettlebells", "primaryMuscles": ["glutes"], "secondaryMuscles": [],
            "instructions": [], "category": "plyometrics", "images": [], "id": "KB_Swing" },
          { "name": "Hamstring Stretch", "force": null, "level": "beginner", "mechanic": null,
            "equipment": null, "primaryMuscles": ["hamstrings"], "secondaryMuscles": [],
            "instructions": [], "category": "stretching", "images": [], "id": "Ham_Stretch" },
          { "name": "", "id": "Broken" }
        ]
        """;

    [Fact]
    public async Task Import_MapsUpstreamFields()
    {
        await using var db = NewDb();
        Assert.Equal(6, await Import(db));
        var all = await db.Exercises.ToDictionaryAsync(e => e.SourceId!);

        var lunge = all["Dumbbell_Lunges"];
        Assert.Equal(ExerciseEquipment.Dumbbell, lunge.Equipment);
        Assert.Equal(ExerciseMechanic.Compound, lunge.Mechanic);
        Assert.Equal(["Quadriceps"], lunge.PrimaryMuscles);
        Assert.Equal(["Glutes", "Hamstrings", "Calves"], lunge.SecondaryMuscles);
        Assert.Equal(2, lunge.ImagePaths.Count);
        Assert.False(lunge.IsTimed);
        Assert.False(lunge.Hidden);

        Assert.True(all["Plank"].IsTimed);                                     // static force
        Assert.True(all["Ham_Stretch"].IsTimed);                               // stretching
        Assert.Equal(ExerciseEquipment.BodyOnly, all["Ham_Stretch"].Equipment); // null = bodyweight
        Assert.True(all["Atlas_Stones"].Hidden);                               // strongman
        Assert.Equal(["LowerBack"], all["Atlas_Stones"].PrimaryMuscles);
        Assert.Equal(["MiddleBack"], all["Atlas_Stones"].SecondaryMuscles);
        Assert.Equal(ExerciseEquipment.EzBar, all["EZ_Curl"].Equipment);
        Assert.Empty(all["EZ_Curl"].ImagePaths);                               // traversal path dropped
        Assert.Equal(ExerciseEquipment.Kettlebell, all["KB_Swing"].Equipment);
        Assert.Null(all["KB_Swing"].Force);
    }

    [Fact]
    public async Task Import_IsInsertOnly_AndNeverOverwritesEnrichment()
    {
        await using var db = NewDb();
        await Import(db);
        var plank = await db.Exercises.SingleAsync(e => e.SourceId == "Plank");
        plank.NamePl = "Deska";
        plank.TipsPl = ["Napnij brzuch"];
        plank.Level = ExerciseLevel.Intermediate;
        db.Exercises.Remove(await db.Exercises.SingleAsync(e => e.SourceId == "KB_Swing"));
        await db.SaveChangesAsync();

        Assert.Equal(1, await Import(db)); // only the deleted one comes back
        plank = await db.Exercises.AsNoTracking().SingleAsync(e => e.SourceId == "Plank");
        Assert.Equal("Deska", plank.NamePl);
        Assert.Equal(["Napnij brzuch"], plank.TipsPl);
        Assert.Equal(ExerciseLevel.Intermediate, plank.Level);
        Assert.Equal(0, await Import(db));
    }

    [Fact]
    public async Task VendoredCatalog_ImportsCompletely()
    {
        await using var db = NewDb();
        var added = await ExerciseImport.EnsureImportedAsync(db);
        Assert.True(added > 850, $"imported {added}");
        Assert.All(await db.Exercises.ToListAsync(), e =>
        {
            Assert.NotEmpty(e.PrimaryMuscles);
            Assert.All(e.ImagePaths, p => Assert.True(ExerciseImages.IsValidPath(p)));
        });
    }

    [Theory]
    [InlineData(Muscle.MiddleBack, "middle-back")]
    [InlineData(Muscle.Glutes, "glutes")]
    public void Tokens_RoundTrip(Muscle m, string token)
    {
        Assert.Equal(token, ExerciseTokens.Of(m));
        Assert.True(ExerciseTokens.TryParse<Muscle>(token, out var back));
        Assert.Equal(m, back);
        Assert.True(ExerciseTokens.TryParse<Muscle>(token.Replace('-', ' ').ToUpperInvariant(), out _));
        Assert.False(ExerciseTokens.TryParse<Muscle>("3", out _));
        Assert.False(ExerciseTokens.TryParse<Muscle>("pośladki", out _));
    }

    [Theory]
    [InlineData("Air_Bike/0.jpg", true)]
    [InlineData("3_4_Sit-Up/1.jpg", true)]
    [InlineData("Hammer_Curls_(Dumbbell)/0.jpg", true)]
    [InlineData("../secret/0.jpg", false)]
    [InlineData("Air_Bike/0.png", false)]
    [InlineData("Air_Bike/../../0.jpg", false)]
    [InlineData("https://evil/0.jpg", false)]
    public void ImagePaths_AreValidatedStrictly(string path, bool ok)
        => Assert.Equal(ok, ExerciseImages.IsValidPath(path));

    [Theory]
    [InlineData("dQw4w9WgXcQ", "dQw4w9WgXcQ")]
    [InlineData("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30s", "dQw4w9WgXcQ")]
    [InlineData("https://youtu.be/dQw4w9WgXcQ?si=abc", "dQw4w9WgXcQ")]
    [InlineData("https://www.youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ")]
    [InlineData("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ", "dQw4w9WgXcQ")]
    [InlineData("not a video", null)]
    [InlineData("https://vimeo.com/123456789", null)]
    public void YouTube_ExtractsIds(string input, string? id) => Assert.Equal(id, YouTubeVerifier.ExtractId(input));

    [Fact]
    public async Task YouTube_Verify_MapsOembedStatuses()
    {
        var verifier = new YouTubeVerifier(new StubFactory(req =>
            req.RequestUri!.Query.Contains("AAAAAAAAAAA")
                ? new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = new StringContent("""{"title":"Wykroki z hantlami","author_name":"Trener"}""", Encoding.UTF8, "application/json"),
                }
                : req.RequestUri!.Query.Contains("BBBBBBBBBBB")
                    ? new HttpResponseMessage(HttpStatusCode.Unauthorized)
                    : new HttpResponseMessage(HttpStatusCode.NotFound)));

        var ok = await verifier.VerifyAsync("https://youtu.be/AAAAAAAAAAA");
        Assert.True(ok.Ok);
        Assert.Equal(("AAAAAAAAAAA", "Wykroki z hantlami", "Trener"), (ok.Id, ok.Title, ok.Channel));
        Assert.Contains("osadzanie", (await verifier.VerifyAsync("BBBBBBBBBBB")).Error);
        Assert.Contains("nie istnieje", (await verifier.VerifyAsync("CCCCCCCCCCC")).Error);
    }

    [Fact]
    public void Prepare_ValidatesWithoutMutating_ThenApplies()
    {
        var e = new Exercise { NameEn = "Plank", Level = ExerciseLevel.Beginner };
        var now = DateTimeOffset.UtcNow;

        var (bad, error) = ExerciseCatalog.Prepare(e, Input(namePl: "Deska", level: "legendary"), now);
        Assert.Null(bad);
        Assert.Contains("level", error);
        Assert.Null(e.NamePl);

        (bad, error) = ExerciseCatalog.Prepare(e, Input(tipsPl: Enumerable.Repeat("x", 13).ToList()), now);
        Assert.Null(bad);
        Assert.Contains("maks", error);

        var (patch, _) = ExerciseCatalog.Prepare(e, Input(namePl: " Deska ", tipsPl: ["Napnij brzuch", " "],
            primary: ["abdominals", "lower back"], youtube: "https://youtu.be/AAAAAAAAAAA"), now);
        Assert.NotNull(patch);
        Assert.Equal("https://youtu.be/AAAAAAAAAAA", patch!.YoutubeToVerify);
        Assert.Null(e.NamePl);
        patch.Apply();
        Assert.Equal("Deska", e.NamePl);
        Assert.Equal(["Napnij brzuch"], e.TipsPl);
        Assert.Equal(["Abdominals", "LowerBack"], e.PrimaryMuscles);
        Assert.Equal(now, e.EnrichedAt);
    }

    [Fact]
    public void Prepare_HiddenOnly_DoesNotMarkEnriched()
    {
        var e = new Exercise { NameEn = "Atlas Stones" };
        var (patch, _) = ExerciseCatalog.Prepare(e, Input(hidden: true), DateTimeOffset.UtcNow);
        patch!.Apply();
        Assert.True(e.Hidden);
        Assert.Null(e.EnrichedAt);
    }

    [Fact]
    public void Search_FoldsPolishDiacritics_AcrossBothNames()
    {
        var e = new Exercise { NameEn = "Dumbbell Lunges", NamePl = "Wykroki z hantlami" };
        Assert.True(ExerciseCatalog.Matches(e, "wykroki"));
        Assert.True(ExerciseCatalog.Matches(e, "HANTLAMI lunges"));
        Assert.False(ExerciseCatalog.Matches(e, "przysiad"));
        var squat = new Exercise { NameEn = "Squat", NamePl = "Przysiad ze sztangą" };
        Assert.True(ExerciseCatalog.Matches(squat, "sztanga"));
    }

    [Fact]
    public async Task Catalog_IsPublicToRead_WritesNeedAccess()
    {
        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseTestServer();
        var dbName = Guid.NewGuid().ToString();
        builder.Services.AddDbContext<MiseDbContext>(o => o.UseInMemoryDatabase(dbName));
        builder.Services.AddSingleton<AccessControl>();
        builder.Configuration["ImagesDir"] = Path.Combine(Path.GetTempPath(), "pichci-ex-test-" + Guid.NewGuid());
        builder.Services.AddSingleton<RecipeImageStore>();
        builder.Services.AddHttpClient();
        builder.Services.AddSingleton<ExerciseImages>();
        builder.Services.AddSingleton(new YouTubeVerifier(new StubFactory(_ => new HttpResponseMessage(HttpStatusCode.NotFound))));
        await using var app = builder.Build();
        app.UseMiddleware<ApiAccessMiddleware>();
        app.MapGroup("/api").MapExercises();
        await app.StartAsync();
        using (var scope = app.Services.CreateScope())
            await Import(scope.ServiceProvider.GetRequiredService<MiseDbContext>());
        using var client = app.GetTestClient();

        var list = await client.GetAsync("/api/exercises?muscle=glutes&location=home");
        Assert.Equal(HttpStatusCode.OK, list.StatusCode);
        var body = JsonDocument.Parse(await list.Content.ReadAsStringAsync()).RootElement;
        // Glutes as primary (KB swing) first, then as secondary (lunges); barbell-free, strongman hidden.
        Assert.Equal(2, body.GetProperty("total").GetInt32());
        Assert.Equal("kettlebell", body.GetProperty("items")[0].GetProperty("equipment").GetString());
        Assert.Equal("dumbbell", body.GetProperty("items")[1].GetProperty("equipment").GetString());
        var primaryOnly = JsonDocument.Parse(await client.GetStringAsync("/api/exercises?muscle=glutes&primaryOnly=true")).RootElement;
        Assert.Equal(1, primaryOnly.GetProperty("total").GetInt32());

        Assert.Equal(HttpStatusCode.BadRequest, (await client.GetAsync("/api/exercises?muscle=pośladki")).StatusCode);
        var id = body.GetProperty("items")[0].GetProperty("id").GetString();
        var patch = await client.PatchAsync($"/api/exercises/{id}",
            new StringContent("""{"namePl":"Wymach"}""", Encoding.UTF8, "application/json"));
        Assert.Equal(HttpStatusCode.Unauthorized, patch.StatusCode);
    }

    private static ExerciseEnrichInput Input(string? namePl = null, List<string>? tipsPl = null,
        string? level = null, List<string>? primary = null, string? youtube = null, bool? hidden = null)
        => new(null, namePl, null, tipsPl, null, youtube, null, null, hidden, level, null, null, primary, null);

    private static Task<int> Import(MiseDbContext db)
        => ExerciseImport.ImportAsync(db, new MemoryStream(Encoding.UTF8.GetBytes(Upstream)));

    private static MiseDbContext NewDb() => new(new DbContextOptionsBuilder<MiseDbContext>()
        .UseInMemoryDatabase(Guid.NewGuid().ToString())
        .Options);

    private sealed class StubFactory(Func<HttpRequestMessage, HttpResponseMessage> respond) : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new(new Handler(respond));

        private sealed class Handler(Func<HttpRequestMessage, HttpResponseMessage> respond) : HttpMessageHandler
        {
            protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
                => Task.FromResult(respond(request));
        }
    }
}
