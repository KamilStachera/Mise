using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Mise.Api.Data;
using Mise.Api.Domain;
using Mise.Api.Features;

namespace Mise.Api.Services.Training;

/// <summary>
/// One batch of background enrichment: pick exercises that still lack a Polish description
/// or a demo video, ask GPT (Sous <c>/job</c>, live web search) for structured content, then
/// validate and save it here — GPT never writes to the database, and every video id goes
/// through <see cref="YouTubeVerifier"/>. Existing Polish text is never overwritten.
/// </summary>
public sealed class ExerciseEnrichment(MiseDbContext db, ISousJobs sous, YouTubeVerifier youtube,
    EnrichmentState state, ILogger<ExerciseEnrichment> logger)
{
    /// <summary>Give up on an exercise (until restart) after this many batches without a full result.</summary>
    public const int MaxAttempts = 3;
    public const int MaxListItems = 8;

    public record Item(Guid Id, string? NamePl, List<string> InstructionsPl, List<string> TipsPl,
        List<string> MistakesPl, string? YoutubeUrl);

    public record BatchResult(int Picked, int Described, int Videos, int Failed);

    /// <summary>
    /// Next exercises to work on: in an active plan first, then missing text before missing video,
    /// home equipment, easier levels, strength work; exercises that already failed too often are skipped.
    /// </summary>
    public async Task<List<Exercise>> PickAsync(int size, CancellationToken ct)
    {
        var inPlans = (await db.ProgramExercises
            .Where(x => x.Day!.Program!.Status == ProgramStatus.Active)
            .Select(x => x.ExerciseId).Distinct().ToListAsync(ct)).ToHashSet();
        var candidates = await db.Exercises
            .Where(e => !e.Hidden && (e.EnrichedAt == null || e.YoutubeId == null))
            .ToListAsync(ct);
        return candidates
            .Where(e => state.Attempts(e.Id) < MaxAttempts)
            .OrderBy(e => !inPlans.Contains(e.Id))
            .ThenBy(e => e.EnrichedAt is not null)
            .ThenBy(e => !ExerciseCatalog.HomeEquipment.Contains(e.Equipment))
            .ThenBy(e => e.Level)
            .ThenBy(e => e.Category != ExerciseCategory.Strength)
            .ThenBy(e => e.NameEn, StringComparer.Ordinal)
            .Take(size)
            .ToList();
    }

    public async Task<BatchResult> RunBatchAsync(int size, CancellationToken ct)
    {
        var batch = await PickAsync(size, ct);
        if (batch.Count == 0) return new(0, 0, 0, 0);

        var text = await sous.RunAsync(BuildPrompt(batch), OutputSchema, ct);
        var items = Parse(text).ToDictionary(i => i.Id);
        int described = 0, videos = 0, failed = 0;

        foreach (var e in batch)
        {
            if (!items.TryGetValue(e.Id, out var item))
            {
                state.Fail(e.Id);
                failed++;
                continue;
            }
            var needsText = e.EnrichedAt is null;
            var hadVideo = e.YoutubeId is not null;
            var (gotText, gotVideo) = await ApplyAsync(e, item, needsText, ct);
            if (gotText) described++;
            if (gotVideo) videos++;
            // Done = has both now. Anything still missing counts as an attempt.
            if ((needsText && !gotText) || (!hadVideo && !gotVideo)) state.Fail(e.Id);
            if (!gotText && !gotVideo) failed++;
        }
        await db.SaveChangesAsync(ct);
        logger.LogInformation("Exercise enrichment: {Picked} picked, {Described} described, {Videos} videos, {Failed} failed",
            batch.Count, described, videos, failed);
        return new(batch.Count, described, videos, failed);
    }

    /// <summary>Text only when the exercise has none; the video only when it has none and the id verifies.</summary>
    private async Task<(bool Text, bool Video)> ApplyAsync(Exercise e, Item item, bool needsText, CancellationToken ct)
    {
        var gotText = false;
        if (needsText && !string.IsNullOrWhiteSpace(item.NamePl) && item.InstructionsPl.Count > 0)
        {
            var input = new ExerciseEnrichInput(null, item.NamePl, item.InstructionsPl, item.TipsPl, item.MistakesPl,
                null, null, null, null, null, null, null, null, null);
            var (patch, error) = ExerciseCatalog.Prepare(e, input, DateTimeOffset.UtcNow);
            if (patch is not null)
            {
                patch.Apply();
                gotText = true;
            }
            else logger.LogWarning("Enrichment text for {Exercise} rejected: {Error}", e.NameEn, error);
        }

        var gotVideo = false;
        if (e.YoutubeId is null && YouTubeVerifier.ExtractId(item.YoutubeUrl) is not null)
        {
            var video = await youtube.VerifyAsync(item.YoutubeUrl, ct);
            if (video.Ok)
            {
                ExerciseCatalog.SetVideo(e, video);
                e.UpdatedAt = DateTimeOffset.UtcNow;
                gotVideo = true;
            }
            else logger.LogInformation("Enrichment video for {Exercise} rejected: {Error}", e.NameEn, video.Error);
        }
        return (gotText, gotVideo);
    }

    // ---- prompt & schema ----

    public static string BuildPrompt(IEnumerable<Exercise> batch)
    {
        var list = batch.Select(e => new
        {
            id = e.Id,
            nameEn = e.NameEn,
            equipment = ExerciseTokens.Of(e.Equipment),
            level = ExerciseTokens.Of(e.Level),
            primaryMuscles = ExerciseTokens.MuscleTokens(e.PrimaryMuscles),
            secondaryMuscles = ExerciseTokens.MuscleTokens(e.SecondaryMuscles),
            instructionsEn = e.InstructionsEn,
            existingNamePl = e.NamePl,
        });
        var json = JsonSerializer.Serialize(list, new JsonSerializerOptions { WriteIndented = false });
        return $$"""
            Jesteś trenerką personalną i piszesz po polsku opisy ćwiczeń do aplikacji treningowej
            dla osoby ćwiczącej w domu i na siłowni. Dla KAŻDEGO ćwiczenia z listy podaj:

            - namePl: polska nazwa, jak mówi się na siłowni (np. „Wykroki z hantlami”, „Hip thrust
              ze sztangą”, „Martwy ciąg rumuński”). Przyjęte angielskie nazwy (hip thrust, plank)
              zostaw. Jeśli jest existingNamePl, przepisz ją bez zmian.
            - instructionsPl: 3–6 krótkich kroków w trybie rozkazującym, na podstawie instructionsEn.
            - tipsPl: 2–4 wskazówki „Na co uważać” — ustawienie ciała, tempo, oddech, co czuć.
            - mistakesPl: 2–4 „Częste błędy” — czego NIE robić.
            - youtubeUrl: wyszukaj w sieci krótki film instruktażowy (najlepiej do 5 minut), który
              pokazuje DOKŁADNIE to ćwiczenie i jego technikę. Najpierw szukaj po polsku, potem po
              angielsku; filmów w innych językach nie podawaj. Podaj adres skopiowany z wyników wyszukiwania (youtube.com/watch?v=…,
              youtu.be/… albo youtube.com/shorts/…). Nigdy nie zgaduj ani nie składaj identyfikatora
              — jeśli nie znalazłeś pewnego filmu, wpisz null.

            Pisz zwięźle i prostym językiem, bez wstępów. Każdy punkt to jedno zdanie. id przepisz
            dokładnie. Zwróć wyłącznie JSON zgodny ze schematem.

            Ćwiczenia:
            {{json}}
            """;
    }

    /// <summary>Strict JSON schema for Codex structured output (all keys required, nullable video).</summary>
    public static readonly JsonObject OutputSchema = JsonNode.Parse("""
        {
          "type": "object",
          "additionalProperties": false,
          "required": ["items"],
          "properties": {
            "items": {
              "type": "array",
              "items": {
                "type": "object",
                "additionalProperties": false,
                "required": ["id", "namePl", "instructionsPl", "tipsPl", "mistakesPl", "youtubeUrl"],
                "properties": {
                  "id": { "type": "string" },
                  "namePl": { "type": "string" },
                  "instructionsPl": { "type": "array", "items": { "type": "string" } },
                  "tipsPl": { "type": "array", "items": { "type": "string" } },
                  "mistakesPl": { "type": "array", "items": { "type": "string" } },
                  "youtubeUrl": { "type": ["string", "null"] }
                }
              }
            }
          }
        }
        """)!.AsObject();

    /// <summary>Tolerant parse of the model's JSON; drops items without a valid id, trims and caps lists.</summary>
    public static List<Item> Parse(string? text)
    {
        var result = new List<Item>();
        if (string.IsNullOrWhiteSpace(text)) return result;
        var start = text.IndexOf('{');
        var end = text.LastIndexOf('}');
        if (start < 0 || end <= start) return result;
        try
        {
            using var doc = JsonDocument.Parse(text[start..(end + 1)]);
            if (!doc.RootElement.TryGetProperty("items", out var items) || items.ValueKind != JsonValueKind.Array)
                return result;
            foreach (var el in items.EnumerateArray())
            {
                if (el.ValueKind != JsonValueKind.Object) continue;
                if (!Guid.TryParse(Str(el, "id"), out var id)) continue;
                result.Add(new Item(id, Clip(Str(el, "namePl"), 200), List(el, "instructionsPl"), List(el, "tipsPl"),
                    List(el, "mistakesPl"), Str(el, "youtubeUrl")));
            }
        }
        catch (JsonException) { }
        return result;
    }

    private static string? Str(JsonElement el, string prop)
        => el.TryGetProperty(prop, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString()?.Trim() : null;

    private static List<string> List(JsonElement el, string prop)
        => el.TryGetProperty(prop, out var v) && v.ValueKind == JsonValueKind.Array
            ? v.EnumerateArray().Where(x => x.ValueKind == JsonValueKind.String)
                .Select(x => Clip(x.GetString()?.Trim(), ExerciseCatalog.MaxItemLength)!)
                .Where(x => !string.IsNullOrEmpty(x)).Take(MaxListItems).ToList()
            : [];

    private static string? Clip(string? s, int max) => s is null ? null : s.Length <= max ? s : s[..max];
}

/// <summary>
/// Process-wide worker state: per-exercise attempt counts (reset on restart — a later run may
/// find a video that wasn't there before), the last outcome for the status endpoint, and a
/// "kick" so a new plan gets its exercises described right away instead of at the next tick.
/// </summary>
public sealed class EnrichmentState
{
    private readonly Dictionary<Guid, int> attempts = [];
    private readonly SemaphoreSlim kick = new(0, 1);
    private readonly object gate = new();

    public bool Enabled { get; set; }
    public bool Running { get; set; }
    public DateTimeOffset? LastRunAt { get; set; }
    public string? LastError { get; set; }
    public DateTimeOffset? PausedUntil { get; set; }

    public int Attempts(Guid id) { lock (gate) return attempts.GetValueOrDefault(id); }

    public void Fail(Guid id) { lock (gate) attempts[id] = attempts.GetValueOrDefault(id) + 1; }

    /// <summary>Wake the worker now (e.g. a new program was saved).</summary>
    public void Kick()
    {
        lock (gate)
            if (kick.CurrentCount == 0) kick.Release();
    }

    /// <summary>Sleep up to <paramref name="delay"/>, or until kicked.</summary>
    public async Task WaitAsync(TimeSpan delay, CancellationToken ct)
    {
        try { await kick.WaitAsync(delay, ct); }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { }
    }
}
