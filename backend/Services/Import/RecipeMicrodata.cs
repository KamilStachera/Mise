using System.Net;
using System.Text.RegularExpressions;
using HtmlAgilityPack;

namespace Mise.Api.Services.Import;

/// <summary>
/// schema.org Recipe as HTML microdata (itemscope/itemprop) — what some big Polish sites
/// (e.g. aniagotuje.pl) publish instead of JSON-LD. Only consulted when JSON-LD had no recipe.
/// </summary>
public static partial class RecipeMicrodata
{
    public static List<ImportedRecipe> Parse(string html, Func<string?, string?> absolute)
    {
        var doc = new HtmlDocument();
        doc.LoadHtml(html);
        var scopes = doc.DocumentNode.SelectNodes("//*[@itemscope and contains(@itemtype, 'schema.org/Recipe')]");
        if (scopes is null) return [];

        var recipes = new List<ImportedRecipe>();
        foreach (var scope in scopes)
        {
            var props = OwnProps(scope).ToList();
            HtmlNode? First(string name) => props.FirstOrDefault(p => Has(p, name));
            IEnumerable<HtmlNode> All(string name) => props.Where(p => Has(p, name));

            var name = Value(First("name"));
            var ingredients = All("recipeIngredient").Concat(All("ingredients"))
                .Select(Value).OfType<string>().ToList();
            var steps = new List<string>();
            foreach (var node in All("recipeInstructions"))
            {
                if (IsScope(node))
                {
                    if (StepOf(node) is { } step) steps.Add(step);
                }
                else if (node.SelectNodes(".//*[@itemscope]") is { Count: > 0 } items)
                    steps.AddRange(items.Select(StepOf).OfType<string>());
                else if (node.SelectNodes(".//*[@itemprop='text']") is { Count: > 0 } texts)
                    steps.AddRange(texts.Select(Value).OfType<string>());
                else
                    steps.AddRange(Lines(node));
            }
            if (name is null && ingredients.Count == 0 && steps.Count == 0) continue;

            ImportedNutrition? nutrition = null;
            if (First("nutrition") is { } n)
            {
                var np = OwnProps(n).ToList();
                string? Nut(string key) => Value(np.FirstOrDefault(p => Has(p, key)));
                nutrition = new ImportedNutrition(Nut("calories"), Nut("proteinContent"), Nut("fatContent"),
                    Nut("carbohydrateContent"), Nut("servingSize"));
                if (nutrition is { Calories: null, Protein: null, Fat: null, Carbs: null }) nutrition = null;
            }

            var author = First("author") is { } a
                ? IsScope(a) ? Value(OwnProps(a).FirstOrDefault(p => Has(p, "name"))) : Value(a)
                : null;

            recipes.Add(new ImportedRecipe(
                name ?? "(bez nazwy)",
                Value(First("description")),
                All("recipeYield").Select(Value).OfType<string>().OrderByDescending(v => v.Length).FirstOrDefault(),
                RecipePageParser.Minutes(Value(First("prepTime"))),
                RecipePageParser.Minutes(Value(First("cookTime"))),
                RecipePageParser.Minutes(Value(First("totalTime"))),
                ingredients,
                steps,
                absolute(Value(First("image"))),
                Value(First("recipeCuisine")),
                Value(First("recipeCategory")),
                author,
                nutrition));
        }
        return recipes;
    }

    /// <summary>A HowToStep scope: "Heading: text" when it has both, else whichever it has, else its text.</summary>
    private static string? StepOf(HtmlNode scope)
    {
        var props = OwnProps(scope).ToList();
        var name = Value(props.FirstOrDefault(p => Has(p, "name")));
        var text = Value(props.FirstOrDefault(p => Has(p, "text")));
        return RecipePageParser.JoinStep(name, text) ?? Value(scope);
    }

    /// <summary>itemprop descendants that belong to this scope, not to a nested itemscope.</summary>
    private static IEnumerable<HtmlNode> OwnProps(HtmlNode scope)
    {
        foreach (var child in scope.ChildNodes)
        {
            if (child.NodeType != HtmlNodeType.Element) continue;
            if (Attr(child, "itemprop") is not null) yield return child;
            if (!IsScope(child))
                foreach (var p in OwnProps(child)) yield return p;
        }
    }

    private static bool IsScope(HtmlNode node) => Attr(node, "itemscope") is not null;

    private static string? Attr(HtmlNode node, string name) => node.Attributes[name]?.Value;

    private static bool Has(HtmlNode node, string prop) =>
        (Attr(node, "itemprop") ?? "").Split(' ', StringSplitOptions.RemoveEmptyEntries).Contains(prop);

    /// <summary>The microdata value: content/datetime/src/href attributes first, else the text.</summary>
    private static string? Value(HtmlNode? node)
    {
        if (node is null) return null;
        var attr = Attr(node, "content")
            ?? Attr(node, "datetime")
            ?? (node.Name is "img" or "source" ? Attr(node, "src") ?? Attr(node, "data-src") : null)
            ?? (node.Name is "a" or "link" ? Attr(node, "href") : null)
            ?? (node.Name == "meta" ? "" : null);
        if (attr is not null) return Clean(attr);
        // Image props wrapping an <img>.
        if (node.SelectSingleNode(".//img") is { } img && node.InnerText.Trim().Length == 0)
            return Clean(Attr(img, "src") ?? Attr(img, "data-src"));
        return Clean(node.InnerText);
    }

    private static IEnumerable<string> Lines(HtmlNode node)
    {
        var html = BlockBreak().Replace(node.InnerHtml, "\n");
        var text = WebUtility.HtmlDecode(Tag().Replace(html, " "));
        return text.Split('\n').Select(l => Space().Replace(l, " ").Trim()).Where(l => l.Length > 0);
    }

    private static string? Clean(string? s)
    {
        if (string.IsNullOrWhiteSpace(s)) return null;
        var v = Space().Replace(WebUtility.HtmlDecode(s), " ").Trim();
        return v.Length == 0 ? null : v;
    }

    [GeneratedRegex(@"<br\s*/?>|</?(p|div|li|ul|ol|h[1-6]|tr|section)\b[^>]*>", RegexOptions.IgnoreCase)]
    private static partial Regex BlockBreak();

    [GeneratedRegex(@"<[^>]+>")]
    private static partial Regex Tag();

    [GeneratedRegex(@"[\s ]+")]
    private static partial Regex Space();
}
