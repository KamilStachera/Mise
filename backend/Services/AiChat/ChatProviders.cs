using System.Net.Http.Headers;
using System.Runtime.CompilerServices;
using System.Text;
using System.Text.Json;

namespace Mise.Api.Services.AiChat;

public record ChatTurn(string Role, string Content);

public interface IChatProvider
{
    bool Enabled { get; }
    string Name { get; }
    IAsyncEnumerable<string> StreamAsync(string systemPrompt, IReadOnlyList<ChatTurn> history, CancellationToken ct);
}

/// <summary>Default provider when no AI is configured. The primary AI path is the ./context folder.</summary>
public sealed class DisabledChatProvider : IChatProvider
{
    public bool Enabled => false;
    public string Name => "disabled";

    public async IAsyncEnumerable<string> StreamAsync(string systemPrompt, IReadOnlyList<ChatTurn> history,
        [EnumeratorCancellation] CancellationToken ct)
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

    public async IAsyncEnumerable<string> StreamAsync(string systemPrompt, IReadOnlyList<ChatTurn> history,
        [EnumeratorCancellation] CancellationToken ct)
    {
        var messages = new List<object> { new { role = "system", content = systemPrompt } };
        messages.AddRange(history.Select(h => new { role = h.Role == "user" ? "user" : "assistant", content = h.Content }));

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

            if (!string.IsNullOrEmpty(delta)) yield return delta!;
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

    public async IAsyncEnumerable<string> StreamAsync(string systemPrompt, IReadOnlyList<ChatTurn> history,
        [EnumeratorCancellation] CancellationToken ct)
    {
        var messages = new List<object> { new { role = "system", content = systemPrompt } };
        messages.AddRange(history.Select(h => new { role = h.Role == "user" ? "user" : "assistant", content = h.Content }));

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

            if (!string.IsNullOrEmpty(delta)) yield return delta!;
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

            default:
                return new DisabledChatProvider();
        }
    }
}
