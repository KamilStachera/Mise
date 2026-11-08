using System.Net;
using System.Text;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Mise.Api.Data;
using Mise.Api.Domain;
using Mise.Api.Services.Training;
using Xunit;

namespace Mise.Api.Tests;

public class ExerciseEnrichmentTests
{
    private const string GoodVideo = "AAAAAAAAAAA";

    [Fact]
    public void Parse_IsTolerant_AndCapsLists()
    {
        var id = Guid.NewGuid();
        var text = "Oto wynik:\n" + $$"""
            {"items":[
              {"id":"{{id}}","namePl":" Deska ","instructionsPl":["a","b","",null],"tipsPl":["1","2","3","4","5","6","7","8","9","10"],
               "mistakesPl":[],"youtubeUrl":"https://youtu.be/{{GoodVideo}}"},
              {"id":"not-a-guid","namePl":"x","instructionsPl":[],"tipsPl":[],"mistakesPl":[],"youtubeUrl":null}
            ]}
            """ + "\nDzięki!";
        var items = ExerciseEnrichment.Parse(text);
        var item = Assert.Single(items);
        Assert.Equal((id, "Deska"), (item.Id, item.NamePl));
        Assert.Equal(["a", "b"], item.InstructionsPl);
        Assert.Equal(ExerciseEnrichment.MaxListItems, item.TipsPl.Count);
        Assert.Empty(ExerciseEnrichment.Parse("no json here"));
        Assert.Empty(ExerciseEnrichment.Parse("{\"items\": [ broken"));
    }

    [Fact]
    public void Prompt_CarriesIdsAndForbidsGuessing()
    {
        var e = new Exercise { NameEn = "Plank", InstructionsEn = ["Hold."], PrimaryMuscles = ["Abdominals"] };
        var prompt = ExerciseEnrichment.BuildPrompt([e]);
        Assert.Contains(e.Id.ToString(), prompt);
        Assert.Contains("\"primaryMuscles\":[\"abdominals\"]", prompt);
        Assert.Contains("Nigdy nie zgaduj", prompt);
        Assert.Equal("object", ExerciseEnrichment.OutputSchema["type"]!.GetValue<string>());
    }

    [Fact]
    public async Task Pick_PlanExercisesFirst_ThenMissingText_ThenHomeKit()
    {
        await using var db = NewDb();
        var gymNoText = Ex("Cable Row", ExerciseEquipment.Cable);
        var homeNoText = Ex("Dumbbell Row", ExerciseEquipment.Dumbbell);
        var noVideo = Ex("Plank", ExerciseEquipment.BodyOnly, namePl: "Deska");
        var inPlan = Ex("Zercher Squat", ExerciseEquipment.Barbell);
        var done = Ex("Squat", ExerciseEquipment.BodyOnly, namePl: "Przysiad", video: GoodVideo);
        var hidden = Ex("Atlas Stones", ExerciseEquipment.Other);
        hidden.Hidden = true;
        db.Exercises.AddRange(gymNoText, homeNoText, noVideo, inPlan, done, hidden);
        db.People.Add(new Person { Id = 1, Name = "Ola" });
        db.TrainingPrograms.Add(new TrainingProgram
        {
            PersonId = 1, Name = "P", StartDate = new DateOnly(2026, 11, 9), Status = ProgramStatus.Active,
            Days = [new ProgramDay { Week = 1, Weekday = 0, Name = "A", Exercises = [new ProgramExercise { ExerciseId = inPlan.Id }] }],
        });
        await db.SaveChangesAsync();

        var state = new EnrichmentState();
        var picked = await Enrichment(db, state, "{}").PickAsync(10, default);
        Assert.Equal([inPlan.Id, homeNoText.Id, gymNoText.Id, noVideo.Id], picked.Select(e => e.Id));

        for (var i = 0; i < ExerciseEnrichment.MaxAttempts; i++) state.Fail(inPlan.Id);
        Assert.DoesNotContain(inPlan.Id, (await Enrichment(db, state, "{}").PickAsync(10, default)).Select(e => e.Id));
    }

    [Fact]
    public async Task Batch_SavesTextAndVerifiedVideos_NeverOverwritesPolishText()
    {
        await using var db = NewDb();
        var fresh = Ex("Goblet Squat", ExerciseEquipment.Kettlebell);
        var badVideo = Ex("Lunge", ExerciseEquipment.Dumbbell);
        var textDone = Ex("Plank", ExerciseEquipment.BodyOnly, namePl: "Deska (moja)");
        var skipped = Ex("Bridge", ExerciseEquipment.BodyOnly);
        db.Exercises.AddRange(fresh, badVideo, textDone, skipped);
        await db.SaveChangesAsync();

        string Item(Exercise e, string name, string? video) => $$"""
            {"id":"{{e.Id}}","namePl":"{{name}}","instructionsPl":["Krok 1","Krok 2","Krok 3"],
             "tipsPl":["Plecy proste"],"mistakesPl":["Zaokrąglanie pleców"],"youtubeUrl":{{(video is null ? "null" : $"\"https://www.youtube.com/watch?v={video}\"")}}}
            """;
        var reply = $$"""{"items":[{{Item(fresh, "Przysiad goblet", GoodVideo)}},{{Item(badVideo, "Wykroki", "BBBBBBBBBBB")}},{{Item(textDone, "Inna nazwa", GoodVideo)}}]}""";
        var state = new EnrichmentState();

        var result = await Enrichment(db, state, reply).RunBatchAsync(10, default);
        Assert.Equal(new ExerciseEnrichment.BatchResult(4, 2, 2, 1), result);

        var all = await db.Exercises.AsNoTracking().ToDictionaryAsync(e => e.Id);
        Assert.Equal(("Przysiad goblet", GoodVideo), (all[fresh.Id].NamePl, all[fresh.Id].YoutubeId));
        Assert.Equal("Rozgrzewka z YouTube", all[fresh.Id].VideoTitle);
        Assert.NotNull(all[fresh.Id].EnrichedAt);
        Assert.Equal(["Plecy proste"], all[fresh.Id].TipsPl);

        Assert.Equal("Wykroki", all[badVideo.Id].NamePl);         // text kept…
        Assert.Null(all[badVideo.Id].YoutubeId);                  // …unverifiable video dropped
        Assert.Equal(1, state.Attempts(badVideo.Id));             // and the video will be retried

        Assert.Equal("Deska (moja)", all[textDone.Id].NamePl);    // existing Polish text untouched
        Assert.Equal(GoodVideo, all[textDone.Id].YoutubeId);       // only the missing video filled
        Assert.Equal(0, state.Attempts(textDone.Id));

        Assert.Null(all[skipped.Id].NamePl);                      // not in the reply → an attempt
        Assert.Equal(1, state.Attempts(skipped.Id));
        Assert.Equal(0, state.Attempts(fresh.Id));
    }

    [Fact]
    public async Task Kick_WakesTheWorkerEarly()
    {
        var state = new EnrichmentState();
        state.Kick();
        state.Kick(); // coalesces
        var sw = System.Diagnostics.Stopwatch.StartNew();
        await state.WaitAsync(TimeSpan.FromSeconds(30), default);
        Assert.True(sw.Elapsed < TimeSpan.FromSeconds(5));
        Assert.False(ExerciseEnrichmentWorker.IsEnabled(Config(("AI_PROVIDER", "openai"))));
        Assert.True(ExerciseEnrichmentWorker.IsEnabled(Config(("AI_PROVIDER", "codex"))));
        Assert.False(ExerciseEnrichmentWorker.IsEnabled(Config(("AI_PROVIDER", "codex"), ("EXERCISE_ENRICH", "off"))));
    }

    // ---- helpers ----

    private static Microsoft.Extensions.Configuration.IConfiguration Config(params (string Key, string Value)[] values)
        => new Microsoft.Extensions.Configuration.ConfigurationBuilder()
            .AddInMemoryCollection(values.Select(v => new KeyValuePair<string, string?>(v.Key, v.Value)))
            .Build();

    private static Exercise Ex(string name, ExerciseEquipment eq, string? namePl = null, string? video = null) => new()
    {
        NameEn = name,
        Equipment = eq,
        PrimaryMuscles = ["Quadriceps"],
        InstructionsEn = ["Do it."],
        NamePl = namePl,
        EnrichedAt = namePl is null ? null : DateTimeOffset.UtcNow,
        YoutubeId = video,
    };

    private static ExerciseEnrichment Enrichment(MiseDbContext db, EnrichmentState state, string reply)
    {
        // oEmbed stub: only GoodVideo exists.
        var youtube = new YouTubeVerifier(new StubFactory(req => req.RequestUri!.Query.Contains(GoodVideo)
            ? new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent("""{"title":"Rozgrzewka z YouTube","author_name":"Trenerka"}""", Encoding.UTF8, "application/json"),
            }
            : new HttpResponseMessage(HttpStatusCode.NotFound)));
        return new ExerciseEnrichment(db, new StubSous(reply), youtube, state, NullLogger<ExerciseEnrichment>.Instance);
    }

    private static MiseDbContext NewDb() => new(new DbContextOptionsBuilder<MiseDbContext>()
        .UseInMemoryDatabase(Guid.NewGuid().ToString())
        .Options);

    private sealed class StubSous(string reply) : ISousJobs
    {
        public Task<string> RunAsync(string prompt, JsonObject outputSchema, CancellationToken ct) => Task.FromResult(reply);
    }

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
