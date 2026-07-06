using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Mise.Api.Data;
using Mise.Api.Domain;
using Mise.Api.Services;
using Mise.Api.Services.AiChat;

namespace Mise.Api.Features;

public record ChatRequest(string Message, string? SessionId);

public static class ChatEndpoints
{
    public static RouteGroupBuilder MapChat(this RouteGroupBuilder api)
    {
        var g = api.MapGroup("/chat").WithTags("Chat");

        g.MapGet("/health", (IChatProvider provider) =>
            Results.Ok(new { enabled = provider.Enabled, provider = provider.Name }));

        g.MapGet("/history", async (string? sessionId, MiseDbContext db) =>
        {
            var sid = string.IsNullOrWhiteSpace(sessionId) ? "default" : sessionId!;
            var msgs = await db.ChatMessages.AsNoTracking()
                .Where(m => m.SessionId == sid)
                .OrderBy(m => m.CreatedAt)
                .Select(m => new { id = m.Id, role = m.Role, content = m.Content, createdAt = m.CreatedAt })
                .ToListAsync();
            return Results.Ok(msgs);
        });

        g.MapPost("/", async (ChatRequest req, HttpContext ctx, MiseDbContext db,
            IChatProvider provider, ContextExportService export, CancellationToken ct) =>
        {
            if (!provider.Enabled)
                return Results.Json(new
                {
                    enabled = false,
                    message = "In-app chat is off. Use the ./context folder with Codex or Claude Code instead.",
                }, statusCode: StatusCodes.Status503ServiceUnavailable);

            if (string.IsNullOrWhiteSpace(req.Message))
                return Results.BadRequest();

            var sid = string.IsNullOrWhiteSpace(req.SessionId) ? "default" : req.SessionId!;

            db.ChatMessages.Add(new ChatMessage { SessionId = sid, Role = "user", Content = req.Message.Trim() });
            await db.SaveChangesAsync(ct);

            var systemPrompt = await export.BuildCookbookAsync(ct);
            var history = await db.ChatMessages.AsNoTracking()
                .Where(m => m.SessionId == sid)
                .OrderByDescending(m => m.CreatedAt).Take(20)
                .ToListAsync(ct);
            history.Reverse();
            var turns = history.Select(m => new ChatTurn(m.Role, m.Content)).ToList();

            ctx.Response.Headers.ContentType = "text/event-stream";
            ctx.Response.Headers.CacheControl = "no-cache";
            ctx.Response.Headers["X-Accel-Buffering"] = "no";

            var assistant = new StringBuilder();
            var failed = false;
            try
            {
                await foreach (var delta in provider.StreamAsync(systemPrompt, turns, ct))
                {
                    assistant.Append(delta);
                    await WriteEvent(ctx, new { delta });
                }
            }
            catch (Exception) when (!ct.IsCancellationRequested)
            {
                // Provider died mid-stream — keep whatever was generated and tell the client.
                failed = true;
            }

            if (assistant.Length > 0)
            {
                db.ChatMessages.Add(new ChatMessage { SessionId = sid, Role = "ai", Content = assistant.ToString() });
                await db.SaveChangesAsync(ct);
            }

            await WriteEvent(ctx, new { done = true, error = failed });
            return Results.Empty;
        });

        return api;
    }

    private static async Task WriteEvent(HttpContext ctx, object payload)
    {
        var json = JsonSerializer.Serialize(payload);
        await ctx.Response.WriteAsync($"data: {json}\n\n");
        await ctx.Response.Body.FlushAsync();
    }
}
