using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Mise.Api.Services.Strava;

/// <summary>
/// STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET from the Strava API app (strava.com/settings/api).
/// The webhook URL defaults to <c>{PUBLIC_API_BASE}/strava/webhook</c> when that base is https
/// (Strava must reach it); otherwise only the 3-hourly poll and "Pobierz teraz" bring workouts.
/// </summary>
public sealed record StravaOptions(string? ClientId, string? ClientSecret, string? WebhookUrl)
{
    public bool Configured => !string.IsNullOrWhiteSpace(ClientId) && !string.IsNullOrWhiteSpace(ClientSecret);

    /// <summary>
    /// The secret Strava echoes when it validates the webhook subscription. Derived from the client
    /// secret so there is nothing else to configure; it only proves the subscription is ours.
    /// </summary>
    public string VerifyToken =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes("pichci-strava-webhook:" + ClientSecret)))[..32].ToLowerInvariant();

    public static StravaOptions From(IConfiguration config)
    {
        var hook = config["Strava:WebhookUrl"];
        if (string.IsNullOrWhiteSpace(hook) && config["PUBLIC_API_BASE"] is { } apiBase
            && apiBase.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
            hook = apiBase.TrimEnd('/') + "/strava/webhook";
        return new StravaOptions(config["Strava:ClientId"]?.Trim(), config["Strava:ClientSecret"]?.Trim(),
            string.IsNullOrWhiteSpace(hook) ? null : hook.Trim());
    }
}

// ---- Strava API shapes (developers.strava.com/docs/reference) — only the fields Pichci reads ----

public sealed record StravaAthlete(
    [property: JsonPropertyName("id")] long Id,
    [property: JsonPropertyName("firstname")] string? FirstName,
    [property: JsonPropertyName("lastname")] string? LastName);

public sealed record StravaToken(
    [property: JsonPropertyName("access_token")] string AccessToken,
    [property: JsonPropertyName("refresh_token")] string RefreshToken,
    [property: JsonPropertyName("expires_at")] long ExpiresAt,
    [property: JsonPropertyName("athlete")] StravaAthlete? Athlete);

/// <summary>A DetailedActivity. <c>calories</c> exists only on GET /activities/{id}, not in lists.</summary>
public sealed record StravaActivity(
    [property: JsonPropertyName("id")] long Id,
    [property: JsonPropertyName("name")] string? Name,
    [property: JsonPropertyName("sport_type")] string? SportType,
    [property: JsonPropertyName("type")] string? Type,
    [property: JsonPropertyName("start_date")] DateTimeOffset StartDate,
    [property: JsonPropertyName("elapsed_time")] int ElapsedTime,
    [property: JsonPropertyName("moving_time")] int MovingTime,
    [property: JsonPropertyName("calories")] decimal? Calories);

public sealed record StravaActivitySummary(
    [property: JsonPropertyName("id")] long Id,
    [property: JsonPropertyName("start_date")] DateTimeOffset StartDate);

public sealed record StravaSubscription(
    [property: JsonPropertyName("id")] long Id,
    [property: JsonPropertyName("callback_url")] string? CallbackUrl);

/// <summary>
/// A webhook event. Strava doesn't sign them, so an event is only a hint: the handler always
/// re-reads the activity from Strava with the athlete's own token before changing anything.
/// </summary>
public sealed record StravaEvent(
    [property: JsonPropertyName("object_type")] string? ObjectType,
    [property: JsonPropertyName("object_id")] long ObjectId,
    [property: JsonPropertyName("aspect_type")] string? AspectType,
    [property: JsonPropertyName("owner_id")] long OwnerId,
    [property: JsonPropertyName("subscription_id")] long SubscriptionId,
    [property: JsonPropertyName("event_time")] long EventTime,
    [property: JsonPropertyName("updates")] Dictionary<string, JsonElement>? Updates);

public class StravaApiException(HttpStatusCode status, string message) : Exception(message)
{
    public HttpStatusCode Status { get; } = status;
}

/// <summary>Thin typed client over www.strava.com (OAuth + API v3). No retries: callers decide.</summary>
public class StravaClient(HttpClient http)
{
    public const string BaseUrl = "https://www.strava.com/";

    public static string AuthorizeUrl(string clientId, string redirectUri, string state) =>
        $"{BaseUrl}oauth/authorize?client_id={Uri.EscapeDataString(clientId)}&response_type=code"
        + $"&redirect_uri={Uri.EscapeDataString(redirectUri)}&approval_prompt=auto"
        + $"&scope={Uri.EscapeDataString("activity:read_all")}&state={Uri.EscapeDataString(state)}";

    public Task<StravaToken> ExchangeCodeAsync(StravaOptions o, string code, CancellationToken ct = default) =>
        PostFormAsync<StravaToken>("oauth/token", new()
        {
            ["client_id"] = o.ClientId!, ["client_secret"] = o.ClientSecret!, ["code"] = code, ["grant_type"] = "authorization_code",
        }, ct);

    public Task<StravaToken> RefreshAsync(StravaOptions o, string refreshToken, CancellationToken ct = default) =>
        PostFormAsync<StravaToken>("oauth/token", new()
        {
            ["client_id"] = o.ClientId!, ["client_secret"] = o.ClientSecret!, ["refresh_token"] = refreshToken, ["grant_type"] = "refresh_token",
        }, ct);

    public async Task DeauthorizeAsync(string accessToken, CancellationToken ct = default)
    {
        using var res = await http.PostAsync(BaseUrl + "oauth/deauthorize",
            new FormUrlEncodedContent(new Dictionary<string, string> { ["access_token"] = accessToken }), ct);
        await EnsureAsync(res, ct);
    }

    public Task<StravaAthlete> GetAthleteAsync(string accessToken, CancellationToken ct = default) =>
        GetAsync<StravaAthlete>("api/v3/athlete", accessToken, ct)!;

    /// <summary>Null when the activity doesn't exist (any more) or isn't visible to this athlete's token.</summary>
    public async Task<StravaActivity?> GetActivityAsync(string accessToken, long id, CancellationToken ct = default)
    {
        try
        {
            return await GetAsync<StravaActivity>($"api/v3/activities/{id}", accessToken, ct);
        }
        catch (StravaApiException e) when (e.Status == HttpStatusCode.NotFound)
        {
            return null;
        }
    }

    public async Task<List<StravaActivitySummary>> ListActivitiesAsync(string accessToken, DateTimeOffset after, int perPage, CancellationToken ct = default) =>
        await GetAsync<List<StravaActivitySummary>>($"api/v3/athlete/activities?after={after.ToUnixTimeSeconds()}&per_page={perPage}", accessToken, ct) ?? [];

    public async Task<List<StravaSubscription>> ListSubscriptionsAsync(StravaOptions o, CancellationToken ct = default)
    {
        using var res = await http.GetAsync(BaseUrl + $"api/v3/push_subscriptions?client_id={Uri.EscapeDataString(o.ClientId!)}&client_secret={Uri.EscapeDataString(o.ClientSecret!)}", ct);
        await EnsureAsync(res, ct);
        return await res.Content.ReadFromJsonAsync<List<StravaSubscription>>(ct) ?? [];
    }

    /// <summary>Strava validates the callback (GET with hub.challenge) before this returns.</summary>
    public Task<StravaSubscription> CreateSubscriptionAsync(StravaOptions o, string callbackUrl, CancellationToken ct = default) =>
        PostFormAsync<StravaSubscription>("api/v3/push_subscriptions", new()
        {
            ["client_id"] = o.ClientId!, ["client_secret"] = o.ClientSecret!, ["callback_url"] = callbackUrl, ["verify_token"] = o.VerifyToken,
        }, ct);

    public async Task DeleteSubscriptionAsync(StravaOptions o, long id, CancellationToken ct = default)
    {
        using var res = await http.DeleteAsync(BaseUrl + $"api/v3/push_subscriptions/{id}?client_id={Uri.EscapeDataString(o.ClientId!)}&client_secret={Uri.EscapeDataString(o.ClientSecret!)}", ct);
        await EnsureAsync(res, ct);
    }

    private async Task<T?> GetAsync<T>(string path, string accessToken, CancellationToken ct)
    {
        using var req = new HttpRequestMessage(HttpMethod.Get, BaseUrl + path);
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
        using var res = await http.SendAsync(req, ct);
        await EnsureAsync(res, ct);
        return await res.Content.ReadFromJsonAsync<T>(ct);
    }

    private async Task<T> PostFormAsync<T>(string path, Dictionary<string, string> form, CancellationToken ct)
    {
        using var res = await http.PostAsync(BaseUrl + path, new FormUrlEncodedContent(form), ct);
        await EnsureAsync(res, ct);
        return await res.Content.ReadFromJsonAsync<T>(ct) ?? throw new StravaApiException(res.StatusCode, $"Strava {path}: empty response");
    }

    private static async Task EnsureAsync(HttpResponseMessage res, CancellationToken ct)
    {
        if (res.IsSuccessStatusCode) return;
        var body = await res.Content.ReadAsStringAsync(ct);
        throw new StravaApiException(res.StatusCode, $"Strava {(int)res.StatusCode}: {(body.Length > 300 ? body[..300] : body)}");
    }
}
