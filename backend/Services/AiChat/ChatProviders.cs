using System.Net.Http.Headers;
using System.Runtime.CompilerServices;
using System.Text;
using System.Text.Json;

namespace Mise.Api.Services.AiChat;

public record ChatTurn(string Role, string Content);

/// <summary>
/// One turn as a provider sees it. History ends with Message. SystemPrompt is null for
/// providers that read ./context themselves; ThreadId is the provider's own conversation
/// handle from the previous turn (Codex), null on a fresh chat.
/// </summary>
public record ChatTurnRequest(string? SystemPrompt, IReadOnlyList<ChatTurn> History, string Message,
    PersonInfo Person, string? RecipeFocus, string? ThreadId);

/// <summary>Streamed piece of a reply: text, a progress line for the UI, or a new thread handle.</summary>
public record ChatChunk(string? Delta = null, string? Status = null, string? ThreadId = null);

public interface IChatProvider
{
    bool Enabled { get; }
    string Name { get; }
    /// <summary>False when the provider reads the context folder itself (Codex): no cookbook in the prompt.</summary>
    bool NeedsSystemPrompt => true;
    IAsyncEnumerable<ChatChunk> StreamAsync(ChatTurnRequest turn, CancellationToken ct);
}

/// <summary>Default provider when no AI is configured. The primary AI path is the ./context folder.</summary>
public sealed class DisabledChatProvider : IChatProvider
{
    public bool Enabled => false;
    public string Name => "disabled";

    public async IAsyncEnumerable<ChatChunk> StreamAsync(ChatTurnRequest turn, [EnumeratorCancellation] CancellationToken ct)
    {
        await Task.CompletedTask;
        yield break;
    }
}

public sealed class OpenAiChatProvider : IChatProvider
{
    private readonly IHttpClientFactory _http;
    private readonly string _apiKey;
    private readonly string _model;

    public OpenAiChatProvider(IHttpClientFactory http, string apiKey, string model)
    {
        _http = http;
        _apiKey = apiKey;
        _model = model;
    }

    public bool Enabled => true;
    public string Name => "openai";

    public async IAsyncEnumerable<ChatChunk> StreamAsync(ChatTurnRequest turn, [EnumeratorCancellation] CancellationToken ct)
    {
        var messages = new List<object> { new { role = "system", content = turn.SystemPrompt ?? "" } };
        messages.AddRange(turn.History.Select(h => new { role = h.Role == "user" ? "user" : "assistant", content = h.Content }));

        var body = JsonSerializer.Serialize(new { model = _model, stream = true, messages });
        using var req = new HttpRequestMessage(HttpMethod.Post, "https://api.openai.com/v1/chat/completions");
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _apiKey);
        req.Content = new StringContent(body, Encoding.UTF8, "application/json");

        var client = _http.CreateClient();
        client.Timeout = TimeSpan.FromMinutes(5);
        using var resp = await client.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, ct);
        resp.EnsureSuccessStatusCode();

        await using var stream = await resp.Content.ReadAsStreamAsync(ct);
        using var reader = new StreamReader(stream);
        while (!reader.EndOfStream)
        {
            var line = await reader.ReadLineAsync(ct);
            if (string.IsNullOrWhiteSpace(line) || !line.StartsWith("data:")) continue;
            var data = line["data:".Length..].Trim();
            if (data == "[DONE]") break;

            string? delta = null;
            try
            {
                using var doc = JsonDocument.Parse(data);
                delta = doc.RootElement.GetProperty("choices")[0].GetProperty("delta")
                    .TryGetProperty("content", out var c) ? c.GetString() : null;
            }
            catch { /* ignore keep-alive / partial frames */ }

            if (!string.IsNullOrEmpty(delta)) yield return new ChatChunk(Delta: delta);
        }
    }
}

public sealed class OllamaChatProvider : IChatProvider
{
    private readonly IHttpClientFactory _http;
    private readonly string _baseUrl;
    private readonly string _model;

    public OllamaChatProvider(IHttpClientFactory http, string baseUrl, string model)
    {
        _http = http;
        _baseUrl = baseUrl.TrimEnd('/');
        _model = model;
    }

    public bool Enabled => true;
    public string Name => "ollama";

    public async IAsyncEnumerable<ChatChunk> StreamAsync(ChatTurnRequest turn, [EnumeratorCancellation] CancellationToken ct)
    {
        var messages = new List<object> { new { role = "system", content = turn.SystemPrompt ?? "" } };
        messages.AddRange(turn.History.Select(h => new { role = h.Role == "user" ? "user" : "assistant", content = h.Content }));

        var body = JsonSerializer.Serialize(new { model = _model, stream = true, messages });
        using var req = new HttpRequestMessage(HttpMethod.Post, $"{_baseUrl}/api/chat");
        req.Content = new StringContent(body, Encoding.UTF8, "application/json");

        var client = _http.CreateClient();
        client.Timeout = TimeSpan.FromMinutes(5);
        using var resp = await client.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, ct);
        resp.EnsureSuccessStatusCode();

        await using var stream = await resp.Content.ReadAsStreamAsync(ct);
        using var reader = new StreamReader(stream);
        while (!reader.EndOfStream)
        {
            var line = await reader.ReadLineAsync(ct);
            if (string.IsNullOrWhiteSpace(line)) continue;

            string? delta = null;
            try
            {
                using var doc = JsonDocument.Parse(line);
                if (doc.RootElement.TryGetProperty("message", out var m) &&
                    m.TryGetProperty("content", out var c))
                    delta = c.GetString();
            }
            catch { /* ignore */ }

            if (!string.IsNullOrEmpty(delta)) yield return new ChatChunk(Delta: delta);
        }
    }
}

/// <summary>
/// Codex signed in with the household's ChatGPT plan, run by the internal `sous` container
/// (sous/server.mjs). Codex reads ./context and writes through the pichci MCP tools as the
/// chatting person; the conversation lives in a Codex thread, so only the new message is sent.
/// </summary>
public sealed class CodexChatProvider : IChatProvider
{
    private readonly IHttpClientFactory _http;
    private readonly string _baseUrl;

    public CodexChatProvider(IHttpClientFactory http, string baseUrl)
    {
        _http = http;
        _baseUrl = baseUrl.TrimEnd('/');
    }

    public bool Enabled => true;
    public string Name => "codex";
    public bool NeedsSystemPrompt => false;

    public async IAsyncEnumerable<ChatChunk> StreamAsync(ChatTurnRequest turn, [EnumeratorCancellation] CancellationToken ct)
    {
        var now = DateTime.Now; // TZ=Europe/Warsaw in the container
        var body = JsonSerializer.Serialize(new
        {
            prompt = AgentDocs.SousTurn(now, turn.Person.Name, turn.Message, turn.RecipeFocus),
            instructions = AgentDocs.SousInstructions(turn.Person.Name),
            threadId = turn.ThreadId,
            person = turn.Person.Id,
        });
        using var req = new HttpRequestMessage(HttpMethod.Post, $"{_baseUrl}/turn");
        req.Content = new StringContent(body, Encoding.UTF8, "application/json");

        var client = _http.CreateClient();
        // A turn that reads files and calls several tools can take minutes.
        client.Timeout = TimeSpan.FromMinutes(10);
        using var resp = await client.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, ct);
        resp.EnsureSuccessStatusCode();

        await using var stream = await resp.Content.ReadAsStreamAsync(ct);
        using var reader = new StreamReader(stream);
        while (!reader.EndOfStream)
        {
            var line = await reader.ReadLineAsync(ct);
            if (string.IsNullOrWhiteSpace(line)) continue;

            ChatChunk? chunk = null;
            try
            {
                using var doc = JsonDocument.Parse(line);
                var root = doc.RootElement;
                string? Str(string name) => root.TryGetProperty(name, out var v) ? v.GetString() : null;
                // A runner error (not logged in, plan limit) is shown to the user as the reply.
                if ((Str("delta") ?? Str("error")) is { } text) chunk = new ChatChunk(Delta: text);
                else if (Str("status") is { } status) chunk = new ChatChunk(Status: status);
                else if (Str("threadId") is { } thread) chunk = new ChatChunk(ThreadId: thread);
            }
            catch { /* ignore malformed lines */ }

            if (chunk is not null) yield return chunk;
        }
    }
}

public static class ChatProviderFactory
{
    public static IChatProvider Create(IConfiguration config, IHttpClientFactory http)
    {
        var provider = (config["AI_PROVIDER"] ?? "").Trim().ToLowerInvariant();
        switch (provider)
        {
            case "openai":
                var key = config["OPENAI_API_KEY"];
                if (string.IsNullOrWhiteSpace(key)) return new DisabledChatProvider();
                return new OpenAiChatProvider(http, key!, config["OPENAI_MODEL"] ?? "gpt-4o-mini");

            case "ollama":
                var baseUrl = config["OLLAMA_BASE_URL"];
                if (string.IsNullOrWhiteSpace(baseUrl)) return new DisabledChatProvider();
                return new OllamaChatProvider(http, baseUrl!, config["OLLAMA_MODEL"] ?? "llama3.1");

            case "codex":
                return new CodexChatProvider(http, config["SOUS_URL"] is { Length: > 0 } url ? url : "http://sous:8090");

            default:
                return new DisabledChatProvider();
        }
    }
}
