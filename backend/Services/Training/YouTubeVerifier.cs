using System.Net;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Mise.Api.Services.Training;

/// <summary>
/// Agents must never invent video ids. Every write that sets a YouTube id goes through
/// YouTube's public oEmbed endpoint: 404/400 = no such video, 401/403 = embedding disabled.
/// On success it returns the real title and channel, which the UI shows next to the player.
/// </summary>
public partial class YouTubeVerifier(IHttpClientFactory http)
{
    public record Result(bool Ok, string? Id, string? Title, string? Channel, string? Error);

    /// <summary>Accepts a bare id or any watch/shorts/youtu.be/embed URL.</summary>
    public static string? ExtractId(string? input)
    {
        if (string.IsNullOrWhiteSpace(input)) return null;
        var s = input.Trim();
        if (BareId().IsMatch(s)) return s;
        var m = UrlId().Match(s);
        return m.Success ? m.Groups[1].Value : null;
    }

    public async Task<Result> VerifyAsync(string? input, CancellationToken ct = default)
    {
        var id = ExtractId(input);
        if (id is null) return new(false, null, null, null, "Nieprawidłowy identyfikator filmu YouTube.");
        var url = "https://www.youtube.com/oembed?format=json&url="
            + Uri.EscapeDataString("https://www.youtube.com/watch?v=" + id);
        try
        {
            using var client = http.CreateClient();
            client.Timeout = TimeSpan.FromSeconds(10);
            using var res = await client.GetAsync(url, ct);
            if (res.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden)
                return new(false, id, null, null, $"Film {id} nie pozwala na osadzanie — wybierz inny.");
            if (!res.IsSuccessStatusCode)
                return new(false, id, null, null, $"Film {id} nie istnieje na YouTube (sprawdź id, nie zgaduj).");
            using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync(ct));
            var title = doc.RootElement.TryGetProperty("title", out var t) ? t.GetString() : null;
            var channel = doc.RootElement.TryGetProperty("author_name", out var a) ? a.GetString() : null;
            return new(true, id, Trim(title, 300), Trim(channel, 200), null);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or JsonException)
        {
            return new(false, id, null, null, "Nie udało się sprawdzić filmu na YouTube — spróbuj ponownie.");
        }
    }

    private static string? Trim(string? s, int max) => s is null ? null : s.Length <= max ? s : s[..max];

    [GeneratedRegex(@"^[A-Za-z0-9_-]{11}$")]
    private static partial Regex BareId();

    [GeneratedRegex(@"(?:youtube(?:-nocookie)?\.com/(?:watch\?(?:.*&)?v=|shorts/|embed/|live/)|youtu\.be/)([A-Za-z0-9_-]{11})")]
    private static partial Regex UrlId();
}
