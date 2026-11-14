using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Mise.Api.Data;
using Mise.Api.Domain;
using Mise.Api.Services;
using Mise.Api.Services.AiChat;
using Mise.Api.Services.Import;

namespace Mise.Api.Features;

/// <param name="RecipeId">Recipe the user is looking at; its full text is appended to the system prompt.</param>
/// <param name="DocumentId">A PDF uploaded via POST /import/documents and attached to this message.</param>
public record ChatRequest(string Message, string? SessionId, Guid? RecipeId = null, Guid? DocumentId = null);

public static class ChatEndpoints
{
    public static RouteGroupBuilder MapChat(this RouteGroupBuilder api)
    {
        var g = api.MapGroup("/chat").WithTags("Chat");

        // Sous runs on the owner's ChatGPT plan, so the admin switches it on per household.
        g.MapGet("/health", async (IChatProvider provider, Caller caller, MiseDbContext db, CancellationToken ct) =>
            Results.Ok(new
            {
                enabled = provider.Enabled && await SousAllowedAsync(db, caller, ct),
                provider = provider.Name,
            }));

        g.MapGet("/history", async (string? sessionId, MiseDbContext db, PersonScope person) =>
        {
            var sid = SessionOf(sessionId, person);
            var msgs = await db.ChatMessages.AsNoTracking()
                .Where(m => m.SessionId == sid)
                .OrderBy(m => m.CreatedAt)
                .Select(m => new { id = m.Id, role = m.Role, content = m.Content, createdAt = m.CreatedAt })
                .ToListAsync();
            return Results.Ok(msgs);
        });

        // „Nowa rozmowa”: drops the messages and with them the Codex thread handle.
        g.MapDelete("/history", async (string? sessionId, MiseDbContext db, PersonScope person) =>
        {
            var sid = SessionOf(sessionId, person);
            await db.ChatMessages.Where(m => m.SessionId == sid).ExecuteDeleteAsync();
            return Results.NoContent();
        });

        g.MapPost("/", async (ChatRequest req, HttpContext ctx, MiseDbContext db, PersonScope person, Caller caller,
            IChatProvider provider, ContextExportService export, ImportService import, CancellationToken ct) =>
        {
            if (!provider.Enabled || !await SousAllowedAsync(db, caller, ct))
                return Results.Json(new
                {
                    enabled = false,
                    message = "In-app chat is off. Use the ./context folder with Codex or Claude Code instead.",
                }, statusCode: StatusCodes.Status503ServiceUnavailable);

            DocumentInfo? attachment = null;
            if (req.DocumentId is Guid docId)
            {
                attachment = await import.InfoAsync(docId, ct);
                if (attachment is null) return Results.BadRequest(new { error = "Załącznik wygasł — dodaj PDF jeszcze raz." });
            }
            if (string.IsNullOrWhiteSpace(req.Message) && attachment is null)
                return Results.BadRequest();

            var sid = SessionOf(req.SessionId, person);
            var message = string.IsNullOrWhiteSpace(req.Message) ? "Przejrzyj załączony PDF." : req.Message.Trim();
            // What the chat shows; the provider additionally gets how to read the attachment.
            var shown = attachment is null ? message : $"{message}\n📎 {attachment.Name}";
            var providerMessage = attachment is null ? message
                : $"{message}\n\n{await AttachmentNoteAsync(attachment, inlineText: provider.NeedsSystemPrompt, import, ct)}";

            db.ChatMessages.Add(new ChatMessage { SessionId = sid, Role = "user", Content = shown });
            await db.SaveChangesAsync(ct);

            var focus = req.RecipeId is Guid rid ? await export.BuildRecipeFocusAsync(rid, ct) : null;
            string? systemPrompt = null;
            if (provider.NeedsSystemPrompt)
            {
                systemPrompt = await export.BuildCookbookAsync(ct);
                if (focus is not null)
                    systemPrompt += "\n\n---\n\n## Użytkownik ogląda teraz ten przepis\n"
                        + "Odpowiadaj w jego kontekście, chyba że pytanie wyraźnie dotyczy czegoś innego.\n\n"
                        + focus;
            }
            var history = await db.ChatMessages.AsNoTracking()
                .Where(m => m.SessionId == sid)
                .OrderByDescending(m => m.CreatedAt).Take(20)
                .ToListAsync(ct);
            history.Reverse();
            var turns = history.Select(m => new ChatTurn(m.Role, m.Content)).ToList();
            if (turns.Count > 0) turns[^1] = new ChatTurn("user", providerMessage);
            var threadId = history.Where(m => m.Role == "ai").Select(m => ThreadOf(m.MetadataJson)).LastOrDefault(t => t is not null);
            var who = await People.FindAsync(db, person.Id, ct)
                ?? new PersonInfo(person.Id, $"Osoba {person.Id}", null, db.Tenant.HouseholdId ?? 0);

            ctx.Response.Headers.ContentType = "text/event-stream";
            ctx.Response.Headers.CacheControl = "no-cache";
            ctx.Response.Headers["X-Accel-Buffering"] = "no";

            var assistant = new StringBuilder();
            var failed = false;
            try
            {
                var turn = new ChatTurnRequest(systemPrompt, turns, providerMessage, who, focus, threadId);
                await foreach (var chunk in provider.StreamAsync(turn, ct))
                {
                    if (chunk.ThreadId is { } t) threadId = t;
                    if (chunk.Status is { } status) await WriteEvent(ctx, new { status });
                    if (chunk.Delta is { } delta)
                    {
                        assistant.Append(delta);
                        await WriteEvent(ctx, new { delta });
                    }
                }
            }
            catch (Exception) when (!ct.IsCancellationRequested)
            {
                // Provider died mid-stream — keep whatever was generated and tell the client.
                failed = true;
            }

            if (assistant.Length > 0)
            {
                db.ChatMessages.Add(new ChatMessage
                {
                    SessionId = sid,
                    Role = "ai",
                    Content = assistant.ToString(),
                    MetadataJson = threadId is null ? null : JsonSerializer.Serialize(new { codexThread = threadId }),
                });
                await db.SaveChangesAsync(ct);
            }

            await WriteEvent(ctx, new { done = true, error = failed });
            return Results.Empty;
        });

        return api;
    }

    /// <summary>
    /// Codex reads the PDF itself with read_import_document, a slice at a time; providers without
    /// tools get the first slice inline (a long cookbook simply ends there).
    /// </summary>
    private static async Task<string> AttachmentNoteAsync(DocumentInfo doc, bool inlineText, ImportService import, CancellationToken ct)
    {
        var head = $"[Załącznik: PDF „{doc.Name}”, stron: {doc.PageCount}, documentId: {doc.Id}"
            + (doc.LooksScanned ? " — prawie bez tekstu, pewnie skan; poproś o zdjęcia stron" : "") + "]";
        if (!inlineText)
            return head + "\n[Czytaj go narzędziem read_import_document (kolejne strony: nextPage).]";
        var slice = await import.SliceAsync(doc.Id, 1, null, ct);
        var body = string.Join("\n\n", slice!.Pages.Select(p => $"— strona {p.Page} —\n{p.Text}"));
        return $"{head}\n{body}" + (slice.NextPage is null ? "" : $"\n[… dalsze strony od {slice.NextPage} pominięte]");
    }

    private static Task<bool> SousAllowedAsync(MiseDbContext db, Caller caller, CancellationToken ct) =>
        db.Households.AsNoTracking().AnyAsync(h => h.Id == caller.HouseholdId && h.SousEnabled, ct);

    /// <summary>Each person has their own Sous conversation unless the client names a session.</summary>
    private static string SessionOf(string? sessionId, PersonScope person) =>
        string.IsNullOrWhiteSpace(sessionId) ? $"person-{person.Id}" : sessionId!;

    private static string? ThreadOf(string? metadataJson)
    {
        if (metadataJson is null) return null;
        try
        {
            using var doc = JsonDocument.Parse(metadataJson);
            return doc.RootElement.TryGetProperty("codexThread", out var t) ? t.GetString() : null;
        }
        catch (JsonException) { return null; }
    }

    private static async Task WriteEvent(HttpContext ctx, object payload)
    {
        var json = JsonSerializer.Serialize(payload);
        await ctx.Response.WriteAsync($"data: {json}\n\n");
        await ctx.Response.Body.FlushAsync();
    }
}
