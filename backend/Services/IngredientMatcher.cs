using System.Text;
using System.Text.RegularExpressions;
using Mise.Api.Domain;

namespace Mise.Api.Services;

/// <summary>
/// Maps a free-text recipe ingredient ("pomidorki koktajlowe", "2 ząbki czosnku") to a
/// pantry item so we can compute have/missing. Polish-aware: folds diacritics and strips
/// common inflectional endings, so "czosnku" matches "Czosnek", "jajek" matches "Jajka"
/// and "miodu" matches "Miód". Used to auto-link ingredients when recipes are created;
/// the have/missing computation relies on the resulting explicit
/// <see cref="RecipeIngredient.PantryItemId"/>.
/// </summary>
public sealed class IngredientMatcher
{
    private static readonly HashSet<string> Stopwords = new()
    {
        "z", "ze", "w", "we", "i", "do", "na", "od", "po", "dla", "bez", "lub", "oraz",
        "of", "the", "and",
    };

    // Common Polish inflectional endings, tried longest-first; a match is only
    // stripped when it leaves a stem of at least 3 characters.
    private static readonly string[] Endings = new[]
    {
        "iami", "iach", "iego", "iemu", "owie",
        "ami", "ach", "owi", "ego", "emu", "ych", "ich", "ymi", "imi", "iej", "iom", "iow", "iem",
        "ej", "om", "ow", "em", "ie", "ia", "iu", "io", "ii", "ek", "ka", "ki", "ko", "ku",
        "a", "e", "i", "o", "u", "y",
    }.OrderByDescending(s => s.Length).ToArray();

    private readonly record struct Token(string Raw, string Stem);

    public static string Normalize(string s)
    {
        if (string.IsNullOrWhiteSpace(s)) return "";
        s = FoldDiacritics(s.ToLowerInvariant());
        s = Regex.Replace(s, @"\(.*?\)", " ");          // drop "(z puszki)" etc.
        var comma = s.IndexOf(',');
        if (comma >= 0) s = s[..comma];                  // drop ", posiekany" etc.
        s = Regex.Replace(s, @"[^a-z0-9 ]", " ");
        s = Regex.Replace(s, @"\s+", " ").Trim();
        return s;
    }

    private static string FoldDiacritics(string s)
    {
        var sb = new StringBuilder(s.Length);
        foreach (var ch in s)
            sb.Append(ch switch
            {
                'ą' => 'a', 'ć' => 'c', 'ę' => 'e', 'ł' => 'l', 'ń' => 'n',
                'ó' => 'o', 'ś' => 's', 'ź' => 'z', 'ż' => 'z',
                _ => ch,
            });
        return sb.ToString();
    }

    private static string Stem(string w)
    {
        foreach (var end in Endings)
            if (w.Length - end.Length >= 3 && w.EndsWith(end, StringComparison.Ordinal))
                return w[..^end.Length];
        // English plural fallback ("tomatoes" -> "tomatoe" -> prefix-matches "tomato")
        if (w.Length > 3 && w.EndsWith('s') && !w.EndsWith("ss")) return w[..^1];
        return w;
    }

    private static Token[] Tokens(string s) =>
        Normalize(s).Split(' ', StringSplitOptions.RemoveEmptyEntries)
                    .Where(t => t.Length >= 2 && !Stopwords.Contains(t))
                    .Select(t => new Token(t, Stem(t)))
                    .ToArray();

    private static bool TokenMatch(Token a, Token b) =>
        a.Raw == b.Raw
        || a.Stem == b.Stem
        // stems related by inflection: shorter one is a prefix of the longer
        || (a.Stem.Length >= 4 && b.Stem.StartsWith(a.Stem, StringComparison.Ordinal))
        || (b.Stem.Length >= 4 && a.Stem.StartsWith(b.Stem, StringComparison.Ordinal));

    /// <summary>
    /// Score for a full match in both directions ("jajek" ↔ "Jajka"). Quantity
    /// mutations (pantry adjust/bulk) require this; the default cutoff also accepts
    /// one-sided containment ("ząbki czosnku" → "Czosnek"), which is right for
    /// linking recipe ingredients but too loose for changing stock by name —
    /// "Chipsy paprykowe" must not add to "Papryka".
    /// </summary>
    public const int ExactishScore = 85;

    /// <summary>Best-effort pantry match for an ingredient name, or null.</summary>
    public PantryItem? FindMatch(string ingredientName, IEnumerable<PantryItem> pantry,
        int minScore = 60)
    {
        var ing = Tokens(ingredientName);
        if (ing.Length == 0) return null;

        PantryItem? best = null;
        var bestRaw = -1;   // exact-surface matches outrank fuzzy ones
        var bestScore = 0;

        foreach (var p in pantry)
        {
            // An item matches through its name or any alias; take its best score.
            foreach (var candidate in NamesOf(p))
            {
                var pt = Tokens(candidate);
                if (pt.Length == 0) continue;

                var pantryMatched = pt.Count(t => ing.Any(i => TokenMatch(i, t)));
                var ingMatched = ing.Count(i => pt.Any(t => TokenMatch(i, t)));
                var rawMatches = pt.Count(t => ing.Any(i => i.Raw == t.Raw));

                int score;
                if (rawMatches == pt.Length && rawMatches == ing.Length) score = 100;                 // identical
                else if (pantryMatched == pt.Length && ingMatched == ing.Length) score = 85;          // same thing, inflected
                else if (pantryMatched == pt.Length) score = 70 + pt.Length;   // "czosnek" ⊆ "ząbki czosnku"
                else if (ingMatched == ing.Length) score = 60 + ing.Length;    // "ciecierzyca" ⊆ "ciecierzyca (z puszki)"
                else continue;

                if (rawMatches > bestRaw || (rawMatches == bestRaw && score > bestScore))
                {
                    bestRaw = rawMatches;
                    bestScore = score;
                    best = p;
                }
            }
        }

        return bestScore >= minScore ? best : null;
    }

    /// <summary>
    /// Recomputes recipe ingredient links against the current pantry catalog.
    /// The current link is evaluated first, so an equally good candidate does
    /// not cause churn, while a stronger match (especially an exact one) wins.
    /// </summary>
    public int RelinkIngredients(IEnumerable<RecipeIngredient> ingredients,
        IReadOnlyList<PantryItem> pantry)
    {
        var pantryById = pantry.ToDictionary(p => p.Id);
        var changed = 0;

        foreach (var ingredient in ingredients)
        {
            IEnumerable<PantryItem> candidates = pantry;
            if (ingredient.PantryItemId is Guid currentId
                && pantryById.TryGetValue(currentId, out var current))
            {
                // FindMatch keeps the first candidate when scores tie.
                candidates = new[] { current }.Concat(pantry.Where(p => p.Id != currentId));
            }

            var bestMatch = FindMatch(ingredient.Name, candidates);
            if (ingredient.PantryItemId == bestMatch?.Id) continue;

            ingredient.PantryItemId = bestMatch?.Id;
            changed++;
        }

        return changed;
    }

    /// <summary>The item's name plus its semicolon-separated aliases.</summary>
    public static IEnumerable<string> NamesOf(PantryItem p)
    {
        yield return p.Name;
        foreach (var alias in p.Aliases.Split(';',
            StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
            yield return alias;
    }
}
