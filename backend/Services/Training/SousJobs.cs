using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Mise.Api.Services.Training;

/// <summary>One-off structured GPT task on the household's ChatGPT plan (the sous container).</summary>
public interface ISousJobs
{
    /// <summary>Returns the model's final message (JSON matching <paramref name="outputSchema"/>).</summary>
    Task<string> RunAsync(string prompt, JsonObject outputSchema, CancellationToken ct);
}

/// <summary>Thrown when the ChatGPT plan's usage limit is hit — the worker backs off longer.</summary>
public sealed class SousLimitException(string message) : Exception(message);

public sealed class SousJobs(IHttpClientFactory http, IConfiguration config) : ISousJobs
{
    private string BaseUrl => (config["SOUS_URL"] is { Length: > 0 } url ? url : "http://sous:8090").TrimEnd('/');

    public async Task<string> RunAsync(string prompt, JsonObject outputSchema, CancellationToken ct)
    {
        using var client = http.CreateClient();
        // A batch with several web searches can take a few minutes.
        client.Timeout = TimeSpan.FromMinutes(12);
        using var res = await client.PostAsJsonAsync($"{BaseUrl}/job", new { prompt, outputSchema }, ct);
        var body = await res.Content.ReadAsStringAsync(ct);
        using var doc = JsonDocument.Parse(string.IsNullOrWhiteSpace(body) ? "{}" : body);
        var root = doc.RootElement;
        if (res.IsSuccessStatusCode && root.TryGetProperty("text", out var text) && text.ValueKind == JsonValueKind.String)
            return text.GetString()!;
        var error = root.TryGetProperty("error", out var e) ? e.GetString() : $"HTTP {(int)res.StatusCode}";
        if (root.TryGetProperty("limit", out var limit) && limit.ValueKind == JsonValueKind.True)
            throw new SousLimitException(error ?? "usage limit");
        throw new InvalidOperationException($"Sous job failed: {error}");
    }
}
