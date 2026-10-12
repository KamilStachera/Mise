using System.Globalization;
using System.Text.Json;
using Microsoft.Extensions.Caching.Memory;

namespace Mise.Api.Services;

/// <summary>Per-100 g nutrition of one product; Serving* from the label when it has one.</summary>
public sealed record OffProduct(string Name, string? Brand, int? KcalPer100g, decimal? Protein, decimal? Fat,
    decimal? Carbs, decimal? ServingGrams, string? ServingLabel);

/// <summary>
/// Barcode lookup against Open Food Facts (v2 product API; free, good Polish coverage).
/// Answers — including "not found" — are cached for a day so re-scans don't hit the API.
/// OFF asks clients to identify themselves via the User-Agent.
/// </summary>
public class OpenFoodFacts(IHttpClientFactory http, IMemoryCache cache, ILogger<OpenFoodFacts> log)
{
    private const string Fields = "product_name,product_name_pl,generic_name_pl,brands,nutriments,serving_quantity,serving_size";

    public static bool IsBarcode(string code) => code.Length is >= 8 and <= 14 && code.All(char.IsAsciiDigit);

    /// <summary>Null = not in OFF (or OFF unreachable — logged, treated the same: type it in).</summary>
    public async Task<OffProduct?> LookupAsync(string code, CancellationToken ct = default)
    {
        if (cache.TryGetValue($"off:{code}", out OffProduct? cached)) return cached;
        OffProduct? product = null;
        try
        {
            var client = http.CreateClient("off");
            client.Timeout = TimeSpan.FromSeconds(8);
            using var req = new HttpRequestMessage(HttpMethod.Get, $"https://world.openfoodfacts.org/api/v2/product/{code}?fields={Fields}");
            req.Headers.UserAgent.ParseAdd("Pichci/1.0 (+https://pichci.com)");
            using var res = await client.SendAsync(req, ct);
            if (res.IsSuccessStatusCode)
            {
                using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync(ct));
                product = Parse(doc.RootElement);
            }
            else if ((int)res.StatusCode >= 500)
            {
                log.LogWarning("Open Food Facts {Status} for {Code}", (int)res.StatusCode, code);
                return null;   // don't cache outages
            }
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or JsonException)
        {
            log.LogWarning(ex, "Open Food Facts lookup failed for {Code}", code);
            return null;
        }
        cache.Set($"off:{code}", product, TimeSpan.FromDays(1));
        return product;
    }

    /// <summary>Maps an OFF v2 response; null when the product is missing or has no name and no kcal.</summary>
    public static OffProduct? Parse(JsonElement root)
    {
        if (!root.TryGetProperty("product", out var p) || p.ValueKind != JsonValueKind.Object) return null;
        var name = Str(p, "product_name_pl") ?? Str(p, "product_name") ?? Str(p, "generic_name_pl");
        decimal? kcal = null, protein = null, fat = null, carbs = null;
        if (p.TryGetProperty("nutriments", out var n) && n.ValueKind == JsonValueKind.Object)
        {
            kcal = Num(n, "energy-kcal_100g") ?? (Num(n, "energy-kj_100g") ?? Num(n, "energy_100g")) / 4.184m;
            protein = Num(n, "proteins_100g");
            fat = Num(n, "fat_100g");
            carbs = Num(n, "carbohydrates_100g");
        }
        if (name is null && kcal is null) return null;
        var brand = Str(p, "brands")?.Split(',')[0].Trim();
        return new OffProduct(name ?? "Produkt bez nazwy", brand, kcal is decimal k ? (int)Math.Round(k) : null,
            Round(protein), Round(fat), Round(carbs), Num(p, "serving_quantity") is decimal s && s > 0 ? s : null,
            Str(p, "serving_size"));
    }

    private static decimal? Round(decimal? v) => v is decimal d ? Math.Round(d, 1) : null;

    private static string? Str(JsonElement o, string key) =>
        o.TryGetProperty(key, out var v) && v.ValueKind == JsonValueKind.String && !string.IsNullOrWhiteSpace(v.GetString())
            ? v.GetString()!.Trim() : null;

    /// <summary>OFF mixes numbers and numeric strings ("21.5").</summary>
    private static decimal? Num(JsonElement o, string key)
    {
        if (!o.TryGetProperty(key, out var v)) return null;
        if (v.ValueKind == JsonValueKind.Number && v.TryGetDecimal(out var d)) return d;
        if (v.ValueKind == JsonValueKind.String && decimal.TryParse(v.GetString()?.Replace(',', '.'), NumberStyles.Number, CultureInfo.InvariantCulture, out var s)) return s;
        return null;
    }
}
