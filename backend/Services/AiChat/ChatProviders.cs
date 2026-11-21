using System.Net.Http.Headers;
using System.Runtime.CompilerServices;
using System.Text;
using System.Text.Json;

namespace Mise.Api.Services.AiChat;

public record ChatTurn(string Role, string Content);

/// <summary>An EXIF-stripped JPEG photo attached to the current chat turn.</summary>
public record ChatImageAttachment(string Name, string MediaType, string DataBase64);

/// <summary>
/// One turn as a provider sees it. History ends with Message. SystemPrompt is null for
/// providers that read ./context themselves; ThreadId is the provider's own conversation
/// handle from the previous turn (Codex), null on a fresh chat.
/// </summary>
public record ChatTurnRequest(string? SystemPrompt, IReadOnlyList<ChatTurn> History, string Message,
    PersonInfo Person, string? RecipeFocus, string? ThreadId,
    IReadOnlyList<ChatImageAttachment>? Images = null);

/// <summary>Streamed piece of a reply: text, a progress line for the UI, a transient runner error, or a new thread handle.</summary>
public record ChatChunk(string? Delta = null, string? Status = null, string? ThreadId = null, string? Error = null);

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
        for (var i = 0; i < turn.History.Count; i++)
        {
            var h = turn.History[i];
            var isLastUser = i == turn.History.Count - 1 && h.Role == "user" && turn.Images is { Count: > 0 };
            if (isLastUser)
            {
                var parts = new List<object> { new { type = "text", text = h.Content } };
                foreach (var img in turn.Images!)
                    parts.Add(new { type = "image_url", image_url = new { url = $"data:{img.MediaType};base64,{img.DataBase64}" } });
                messages.Add(new { role = "user", content = (object)parts });
            }
            else
            {
                messages.Add(new { role = h.Role == "user" ? "user" : "assistant", content = (object)h.Content });
            }
        }

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
        while (await reader.ReadLineAsync(ct) is { } line)
        {
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
        for (var i = 0; i < turn.History.Count; i++)
        {
            var h = turn.History[i];
            var isLastUser = i == turn.History.Count - 1 && h.Role == "user" && turn.Images is { Count: > 0 };
            if (isLastUser)
            {
                messages.Add(new
                {
                    role = "user",
                    content = h.Content,
                    images = turn.Images!.Select(img => img.DataBase64).ToList(),
                });
            }
            else
            {
                messages.Add(new { role = h.Role == "user" ? "user" : "assistant", content = h.Content });
            }
        }

        var body = JsonSerializer.Serialize(new { model = _model, stream = true, messages });
        using var req = new HttpRequestMessage(HttpMethod.Post, $"{_baseUrl}/api/chat");
        req.Content = new StringContent(body, Encoding.UTF8, "application/json");

        var client = _http.CreateClient();
        client.Timeout = TimeSpan.FromMinutes(5);
        using var resp = await client.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, ct);
        resp.EnsureSuccessStatusCode();

        await using var stream = await resp.Content.ReadAsStreamAsync(ct);
        using var reader = new StreamReader(stream);
        while (await reader.ReadLineAsync(ct) is { } line)
        {
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
/// Codex signed in with the owner's ChatGPT plan, run by the internal `sous` container
/// (sous/server.mjs). Codex has no /context mount and no global MISE_API_KEY: each turn carries a
/// short-lived DataProtection token pinned to (householdId, personId), so Sous reads and writes
/// strictly through the pichci MCP tools as the chatting person.
/// </summary>
public sealed class CodexChatProvider : IChatProvider
{
    private readonly IHttpClientFactory _http;
    private readonly string _baseUrl;
    private readonly AccessControl _access;

    public CodexChatProvider(IHttpClientFactory http, string baseUrl, AccessControl access)
    {
        _http = http;
        _baseUrl = baseUrl.TrimEnd('/');
        _access = access;
    }

    public bool Enabled => true;
    public string Name => "codex";
    public bool NeedsSystemPrompt => false;

    public async IAsyncEnumerable<ChatChunk> StreamAsync(ChatTurnRequest turn, [EnumeratorCancellation] CancellationToken ct)
    {
        var now = DateTime.Now; // TZ=Europe/Warsaw in the container
        var turnToken = _access.MintSousToken(turn.Person.HouseholdId, turn.Person.Id);
        var body = JsonSerializer.Serialize(new
        {
            prompt = AgentDocs.SousTurn(now, turn.Person.Name, turn.Message, turn.RecipeFocus),
            instructions = AgentDocs.SousInstructions(turn.Person.Name),
            threadId = turn.ThreadId,
            person = turn.Person.Id,
            household = turn.Person.HouseholdId,
            token = turnToken,
            images = turn.Images?.Select(i => new { name = i.Name, mediaType = i.MediaType, dataBase64 = i.DataBase64 }).ToList(),
        });
        using var req = new HttpRequestMessage(HttpMethod.Post, $"{_baseUrl}/turn");
        if (_access.SousSecret is { Length: > 0 } secret)
            req.Headers.Add(AccessControl.SousSecretHeader, secret);
        req.Content = new StringContent(body, Encoding.UTF8, "application/json");

        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(TimeSpan.FromMinutes(10));
        var client = _http.CreateClient();
        client.Timeout = Timeout.InfiniteTimeSpan;
        using var resp = await client.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, timeout.Token);
        resp.EnsureSuccessStatusCode();

        await using var stream = await resp.Content.ReadAsStreamAsync(timeout.Token);
        using var reader = new StreamReader(stream);
        while (await reader.ReadLineAsync(timeout.Token) is { } line)
        {
            if (string.IsNullOrWhiteSpace(line)) continue;

            ChatChunk? chunk = null;
            try
            {
                using var doc = JsonDocument.Parse(line);
                var root = doc.RootElement;
                string? Str(string name) => root.TryGetProperty(name, out var v) ? v.GetString() : null;
                if (Str("delta") is { } text) chunk = new ChatChunk(Delta: text);
                else if (Str("error") is { } err) chunk = new ChatChunk(Error: err);
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
    public static IChatProvider Create(IConfiguration config, IHttpClientFactory http, AccessControl access)
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
                return new CodexChatProvider(http, config["SOUS_URL"] is { Length: > 0 } url ? url : "http://sous:8090", access);

            default:
                return new DisabledChatProvider();
        }
    }
}
