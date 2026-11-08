using System.Text.RegularExpressions;

namespace Mise.Api.Services.Training;

/// <summary>
/// free-exercise-db step photos, fetched from GitHub (pinned commit) the first time they are
/// asked for, re-encoded to WebP and cached in the images volume under exercises-v1/. Nothing is
/// committed to the repo and phones never hit GitHub directly. Paths are validated against a
/// strict pattern before they reach the filesystem or the URL.
/// </summary>
public partial class ExerciseImages(RecipeImageStore store, IHttpClientFactory http, ILogger<ExerciseImages> logger)
{
    public const int MaxSize = 720;
    private const string BaseUrl = "https://raw.githubusercontent.com/yuhonas/free-exercise-db/"
        + ExerciseImport.UpstreamSha + "/exercises/";
    // A cold catalog page asks for ~24 thumbnails at once; 4 parallel fetches keep it snappy
    // without hammering GitHub or holding many decodes in memory.
    private static readonly SemaphoreSlim Gate = new(4, 4);

    public string CacheDir => Path.Combine(store.Root, "exercises-v1");

    /// <summary>"Air_Bike/0.jpg" style only — no traversal, no other hosts, no other extensions.</summary>
    public static bool IsValidPath(string? path) => path is not null && PathPattern().IsMatch(path);

    public string CachedPath(string path) => Path.Combine(CacheDir, Path.ChangeExtension(path, ".webp")!);

    /// <summary>Local WebP for an upstream image path, downloading on a cache miss; null when unavailable.</summary>
    public async Task<string?> GetAsync(string path, CancellationToken ct = default)
    {
        if (!IsValidPath(path)) return null;
        var cached = CachedPath(path);
        if (File.Exists(cached)) return cached;
        await Gate.WaitAsync(ct);
        var temp = Path.Combine(Path.GetTempPath(), "pichci-ex-" + Guid.NewGuid().ToString("N") + ".jpg");
        try
        {
            if (File.Exists(cached)) return cached;
            using var client = http.CreateClient();
            client.Timeout = TimeSpan.FromSeconds(20);
            using var res = await client.GetAsync(BaseUrl + path, HttpCompletionOption.ResponseHeadersRead, ct);
            if (!res.IsSuccessStatusCode)
            {
                logger.LogWarning("Exercise image {Path}: upstream {Status}", path, (int)res.StatusCode);
                return null;
            }
            if (res.Content.Headers.ContentLength > 5 * 1024 * 1024) return null;
            await using (var file = File.Create(temp))
                await res.Content.CopyToAsync(file, ct);
            return await Task.Run(() => ImageResizer.TryWriteWebp(temp, cached, MaxSize) ? cached : null, ct);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or IOException)
        {
            logger.LogWarning("Exercise image {Path}: {Message}", path, ex.Message);
            return null;
        }
        finally
        {
            Gate.Release();
            if (File.Exists(temp)) File.Delete(temp);
        }
    }

    [GeneratedRegex(@"^[A-Za-z0-9_\-()]+/\d+\.jpg$")]
    private static partial Regex PathPattern();
}
