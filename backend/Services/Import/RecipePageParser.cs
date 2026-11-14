using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Xml;

namespace Mise.Api.Services.Import;

/// <summary>A schema.org Recipe as the site published it — raw, unnormalized, in the site's language.</summary>
public sealed record ImportedRecipe(
    string Name,
    string? Description,
    string? Yield,
    int? PrepMinutes,
    int? CookMinutes,
    int? TotalMinutes,
    IReadOnlyList<string> Ingredients,
    IReadOnlyList<string> Steps,
    string? ImageUrl,
    string? Cuisine,
    string? Category,
    string? Author,
    ImportedNutrition? Nutrition);

/// <summary>Strings as published ("320 kcal", "12 g"); per serving per schema.org.</summary>
public sealed record ImportedNutrition(string? Calories, string? Protein, string? Fat, string? Carbs, string? ServingSize);

public sealed record ImportedPage(string? Title, string? ImageUrl, IReadOnlyList<ImportedRecipe> Recipes, string? Text, bool TextTruncated);

/// <summary>
/// Pulls recipes out of an HTML page. Nearly every recipe site embeds schema.org Recipe
/// JSON-LD for Google — that is exact and structured, so it wins. Pages without it fall back
/// to the visible text (capped) for the agent to read.
/// </summary>
public static partial class RecipePageParser
{
    public const int MaxTextChars = 30_000;

    static RecipePageParser() => Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);

    /// <summary>Header charset → &lt;meta charset&gt; → UTF-8 (Polish sites still ship ISO-8859-2 / windows-1250).</summary>
    public static string Decode(byte[] bytes, string? headerCharset)
    {
        var name = headerCharset;
        if (string.IsNullOrWhiteSpace(name))
        {
            var head = Encoding.ASCII.GetString(bytes, 0, Math.Min(bytes.Length, 4096));
            name = MetaCharset().Match(head) is { Success: true } m ? m.Groups[1].Value : null;
        }
        Encoding encoding;
        try { encoding = name is null ? Encoding.UTF8 : Encoding.GetEncoding(name.Trim('"', '\'', ' ')); }
        catch (ArgumentException) { encoding = Encoding.UTF8; }
        return encoding.GetString(bytes);
    }

    public static ImportedPage Parse(string html, Uri baseUrl)
    {
        var recipes = new List<ImportedRecipe>();
        foreach (Match m in JsonLdScript().Matches(html))
        {
            try
            {
                using var doc = JsonDocument.Parse(m.Groups[1].Value.Trim(),
                    new JsonDocumentOptions { AllowTrailingCommas = true, CommentHandling = JsonCommentHandling.Skip });
                foreach (var node in RecipeNodes(doc.RootElement))
                    if (ToRecipe(node, baseUrl) is { } r && !recipes.Any(x => x.Name == r.Name))
                        recipes.Add(r);
            }
            catch (JsonException) { /* a broken block from some plugin — try the next one */ }
        }

        if (recipes.Count == 0)
            recipes.AddRange(RecipeMicrodata.Parse(html, url => Absolute(url, baseUrl)));

        var title = MetaContent(html, "og:title") ?? Clean(TitleTag().Match(html).Groups[1].Value);
        var image = Absolute(MetaContent(html, "og:image"), baseUrl);
        // Complete structured data needs no page text; a stub (name + photo only) still does.
        if (recipes.Count > 0 && recipes.All(r => r.Ingredients.Count > 0 && r.Steps.Count > 0))
            return new ImportedPage(NullIfEmpty(title), image, recipes, null, false);

        var text = VisibleText(html);
        var truncated = text.Length > MaxTextChars;
        return new ImportedPage(NullIfEmpty(title), image, recipes, truncated ? text[..MaxTextChars] : text, truncated);
    }

    /// <summary>Recipe objects anywhere: top level, arrays, @graph, or nested (mainEntity, itemListElement).</summary>
    private static IEnumerable<JsonElement> RecipeNodes(JsonElement e, int depth = 0)
    {
        if (depth > 8) yield break;
        if (e.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in e.EnumerateArray())
                foreach (var r in RecipeNodes(item, depth + 1)) yield return r;
            yield break;
        }
        if (e.ValueKind != JsonValueKind.Object) yield break;
        if (IsType(e, "Recipe"))
        {
            yield return e;
            yield break;
        }
        foreach (var prop in e.EnumerateObject())
            if (prop.Value.ValueKind is JsonValueKind.Object or JsonValueKind.Array)
                foreach (var r in RecipeNodes(prop.Value, depth + 1)) yield return r;
    }

    private static bool IsType(JsonElement e, string type) =>
        e.TryGetProperty("@type", out var t) && (t.ValueKind == JsonValueKind.String
            ? t.GetString() == type
            : t.ValueKind == JsonValueKind.Array && t.EnumerateArray().Any(x => x.ValueKind == JsonValueKind.String && x.GetString() == type));

    private static ImportedRecipe? ToRecipe(JsonElement r, Uri baseUrl)
    {
        var name = Text(r, "name");
        var ingredients = Strings(r, "recipeIngredient").Concat(Strings(r, "ingredients")).ToList();
        var steps = new List<string>();
        if (r.TryGetProperty("recipeInstructions", out var instr)) CollectSteps(instr, steps, 0);
        if (name is null && ingredients.Count == 0 && steps.Count == 0) return null;

        ImportedNutrition? nutrition = null;
        if (r.TryGetProperty("nutrition", out var n) && n.ValueKind == JsonValueKind.Object)
        {
            nutrition = new ImportedNutrition(Text(n, "calories"), Text(n, "proteinContent"), Text(n, "fatContent"),
                Text(n, "carbohydrateContent"), Text(n, "servingSize"));
            if (nutrition is { Calories: null, Protein: null, Fat: null, Carbs: null }) nutrition = null;
        }

        return new ImportedRecipe(
            name ?? "(bez nazwy)",
            Text(r, "description"),
            Yield(r),
            Minutes(Text(r, "prepTime")),
            Minutes(Text(r, "cookTime")),
            Minutes(Text(r, "totalTime")),
            ingredients,
            steps,
            Absolute(ImageOf(r), baseUrl),
            Joined(r, "recipeCuisine"),
            Joined(r, "recipeCategory"),
            AuthorOf(r),
            nutrition);
    }

    /// <summary>Strings, HowToStep (text/name), HowToSection (name + itemListElement), nested lists.</summary>
    private static void CollectSteps(JsonElement e, List<string> steps, int depth)
    {
        if (depth > 6) return;
        switch (e.ValueKind)
        {
            case JsonValueKind.String:
                // A single HTML blob: split on paragraphs / list items / line breaks.
                foreach (var part in BlockBreak().Replace(e.GetString() ?? "", "\n").Split('\n'))
                    if (Clean(part) is { Length: > 0 } s) steps.Add(s);
                break;
            case JsonValueKind.Array:
                foreach (var item in e.EnumerateArray()) CollectSteps(item, steps, depth + 1);
                break;
            case JsonValueKind.Object:
                if (e.TryGetProperty("itemListElement", out var list))
                {
                    if (IsType(e, "HowToSection") && Text(e, "name") is { } section) steps.Add($"[{section}]");
                    CollectSteps(list, steps, depth + 1);
                }
                else if (JoinStep(Text(e, "name"), Text(e, "text")) is { } text)
                    steps.Add(text);
                break;
        }
    }

    /// <summary>
    /// A HowToStep's heading and text as one step. Many sites repeat the start of the text as
    /// its name (or truncate it there) — then the text alone.
    /// </summary>
    public static string? JoinStep(string? name, string? text)
    {
        if (string.IsNullOrWhiteSpace(text)) return string.IsNullOrWhiteSpace(name) ? null : name;
        if (string.IsNullOrWhiteSpace(name)) return text;
        var head = name.TrimEnd('.', '…', ' ');
        return text.StartsWith(head, StringComparison.OrdinalIgnoreCase) ? text : $"{name.TrimEnd(':', ' ')}: {text}";
    }

    private static string? Yield(JsonElement r)
    {
        if (!r.TryGetProperty("recipeYield", out var y)) return null;
        var values = y.ValueKind == JsonValueKind.Array ? y.EnumerateArray().Select(Scalar) : [Scalar(y)];
        // Sites often send ["4", "4 porcje"] — keep the most descriptive one.
        return values.Where(v => v is not null).OrderByDescending(v => v!.Length).FirstOrDefault();
    }

    private static string? ImageOf(JsonElement r)
    {
        if (!r.TryGetProperty("image", out var img)) return null;
        return img.ValueKind switch
        {
            JsonValueKind.String => img.GetString(),
            JsonValueKind.Array => img.EnumerateArray().Select(i => i.ValueKind == JsonValueKind.String ? i.GetString() : Text(i, "url"))
                .LastOrDefault(s => !string.IsNullOrWhiteSpace(s)), // sites list sizes ascending
            JsonValueKind.Object => Text(img, "url") ?? Text(img, "contentUrl"),
            _ => null,
        };
    }

    private static string? AuthorOf(JsonElement r)
    {
        if (!r.TryGetProperty("author", out var a)) return null;
        var names = (a.ValueKind == JsonValueKind.Array ? a.EnumerateArray().ToList() : [a])
            .Select(x => x.ValueKind == JsonValueKind.String ? Clean(x.GetString()) : Text(x, "name"))
            .Where(s => !string.IsNullOrEmpty(s)).ToList();
        return names.Count == 0 ? null : string.Join(", ", names);
    }

    /// <summary>ISO 8601 duration (PT1H30M, P0DT0H20M) → minutes; null when absent, zero or unparseable.</summary>
    public static int? Minutes(string? iso)
    {
        if (string.IsNullOrWhiteSpace(iso)) return null;
        try
        {
            var minutes = (int)Math.Round(XmlConvert.ToTimeSpan(iso.Trim()).TotalMinutes);
            return minutes > 0 ? minutes : null;
        }
        catch (FormatException) { return null; }
    }

    private static string? Text(JsonElement e, string prop) =>
        e.ValueKind == JsonValueKind.Object && e.TryGetProperty(prop, out var v) ? Scalar(v) : null;

    private static string? Scalar(JsonElement v) => v.ValueKind switch
    {
        JsonValueKind.String => NullIfEmpty(Clean(v.GetString())),
        JsonValueKind.Number => v.GetRawText(),
        JsonValueKind.Array => v.EnumerateArray().Select(Scalar).FirstOrDefault(s => s is not null),
        _ => null,
    };

    private static IEnumerable<string> Strings(JsonElement e, string prop)
    {
        if (!e.TryGetProperty(prop, out var v)) return [];
        var items = v.ValueKind == JsonValueKind.Array ? v.EnumerateArray().Select(Scalar) : [Scalar(v)];
        return items.Where(s => s is not null).Select(s => s!);
    }

    private static string? Joined(JsonElement e, string prop)
    {
        var all = Strings(e, prop).Distinct().ToList();
        return all.Count == 0 ? null : string.Join(", ", all);
    }

    private static string? MetaContent(string html, string property)
    {
        foreach (Match m in MetaTag().Matches(html))
        {
            var tag = m.Value;
            var key = AttrValue(tag, "property") ?? AttrValue(tag, "name");
            if (string.Equals(key, property, StringComparison.OrdinalIgnoreCase))
                return NullIfEmpty(Clean(AttrValue(tag, "content")));
        }
        return null;
    }

    private static string? AttrValue(string tag, string attr)
    {
        var m = Regex.Match(tag, $@"\b{attr}\s*=\s*(?:""([^""]*)""|'([^']*)'|([^\s>]+))", RegexOptions.IgnoreCase);
        return m.Success ? m.Groups[1].Success ? m.Groups[1].Value : m.Groups[2].Success ? m.Groups[2].Value : m.Groups[3].Value : null;
    }

    private static string? Absolute(string? url, Uri baseUrl) =>
        string.IsNullOrWhiteSpace(url) ? null
        : Uri.TryCreate(baseUrl, WebUtility.HtmlDecode(url.Trim()), out var abs) && abs.Scheme is "http" or "https" ? abs.ToString()
        : null;

    /// <summary>Main content if the page marks it, else the body; scripts, styles, nav chrome dropped; one block per line.</summary>
    public static string VisibleText(string html)
    {
        var body = MainTag().Match(html) is { Success: true } main ? main.Value
            : ArticleTag().Match(html) is { Success: true } article ? article.Value
            : html;
        body = Invisible().Replace(body, " ");
        body = BlockBreak().Replace(body, "\n");
        body = AnyTag().Replace(body, " ");
        body = WebUtility.HtmlDecode(body);
        var lines = body.Split('\n')
            .Select(l => Spaces().Replace(l, " ").Trim())
            .Where(l => l.Length > 0);
        return string.Join("\n", lines);
    }

    /// <summary>Tags out, entities decoded, whitespace collapsed (JSON-LD fields often carry HTML).</summary>
    private static string Clean(string? s) =>
        string.IsNullOrEmpty(s) ? "" : AllSpace().Replace(WebUtility.HtmlDecode(AnyTag().Replace(WebUtility.HtmlDecode(s), " ")), " ").Trim();

    private static string? NullIfEmpty(string? s) => string.IsNullOrWhiteSpace(s) ? null : s;

    [GeneratedRegex(@"<script[^>]*type\s*=\s*[""']?application/ld\+json[""']?[^>]*>(.*?)</script>", RegexOptions.IgnoreCase | RegexOptions.Singleline)]
    private static partial Regex JsonLdScript();

    [GeneratedRegex(@"<meta[^>]+>", RegexOptions.IgnoreCase)]
    private static partial Regex MetaTag();

    [GeneratedRegex(@"<meta[^>]+charset\s*=\s*[""']?([\w-]+)", RegexOptions.IgnoreCase)]
    private static partial Regex MetaCharset();

    [GeneratedRegex(@"<title[^>]*>(.*?)</title>", RegexOptions.IgnoreCase | RegexOptions.Singleline)]
    private static partial Regex TitleTag();

    [GeneratedRegex(@"<main\b.*?</main>", RegexOptions.IgnoreCase | RegexOptions.Singleline)]
    private static partial Regex MainTag();

    [GeneratedRegex(@"<article\b.*?</article>", RegexOptions.IgnoreCase | RegexOptions.Singleline)]
    private static partial Regex ArticleTag();

    [GeneratedRegex(@"<(script|style|noscript|svg|nav|header|footer|form|iframe|template)\b.*?</\1>|<!--.*?-->", RegexOptions.IgnoreCase | RegexOptions.Singleline)]
    private static partial Regex Invisible();

    [GeneratedRegex(@"<br\s*/?>|</?(p|div|li|ul|ol|h[1-6]|tr|section|table)\b[^>]*>", RegexOptions.IgnoreCase)]
    private static partial Regex BlockBreak();

    [GeneratedRegex(@"<[^>]+>")]
    private static partial Regex AnyTag();

    [GeneratedRegex(@"[\s ]+")]
    private static partial Regex AllSpace();

    [GeneratedRegex(@"[ \t\r\f\v ]+")]
    private static partial Regex Spaces();
}
