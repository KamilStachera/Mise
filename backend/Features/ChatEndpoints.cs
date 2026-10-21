using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Mise.Api.Data;
using Mise.Api.Domain;
using Mise.Api.Services;
using Mise.Api.Services.AiChat;

namespace Mise.Api.Features;

/// <param name="RecipeId">Recipe the user is looking at; its full text is appended to the system prompt.</param>
public record ChatRequest(string Message, string? SessionId, Guid? RecipeId = null);

public static class ChatEndpoints
{
    public static RouteGroupBuilder MapChat(this RouteGroupBuilder api)
    {
        var g = api.MapGroup("/chat").WithTags("Chat");

        g.MapGet("/health", (IChatProvider provider) =>
            Results.Ok(new { enabled = provider.Enabled, provider = provider.Name }));

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

        g.MapPost("/", async (ChatRequest req, HttpContext ctx, MiseDbContext db, PersonScope person,
            People people, IChatProvider provider, ContextExportService export, CancellationToken ct) =>
        {
            if (!provider.Enabled)
                return Results.Json(new
                {
                    enabled = false,
                    message = "In-app chat is off. Use the ./context folder with Codex or Claude Code instead.",
                }, statusCode: StatusCodes.Status503ServiceUnavailable);

            if (string.IsNullOrWhiteSpace(req.Message))
                return Results.BadRequest();

            var sid = SessionOf(req.SessionId, person);
            var message = req.Message.Trim();

            db.ChatMessages.Add(new ChatMessage { SessionId = sid, Role = "user", Content = message });
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
            var threadId = history.Where(m => m.Role == "ai").Select(m => ThreadOf(m.MetadataJson)).LastOrDefault(t => t is not null);
            var who = people.All.FirstOrDefault(p => p.Id == person.Id) ?? new PersonInfo(person.Id, $"Osoba {person.Id}", null);

            ctx.Response.Headers.ContentType = "text/event-stream";
            ctx.Response.Headers.CacheControl = "no-cache";
            ctx.Response.Headers["X-Accel-Buffering"] = "no";

            var assistant = new StringBuilder();
            var failed = false;
            try
            {
                var turn = new ChatTurnRequest(systemPrompt, turns, message, who, focus, threadId);
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
