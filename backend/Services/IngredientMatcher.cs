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
    // stripped when it leaves a stem of at least 3 characters. Derivational
    // diminutive suffixes (-ka/-ki/-ko/-ku) are deliberately NOT stripped so
    // distinct products (Oliwa/Oliwki, Pesto/Pestki, Ciasto/Ciastka, Woda/Wódka)
    // keep distinct stems.
    private static readonly string[] Endings = new[]
    {
        "iami", "iach", "iego", "iemu", "owie",
        "ami", "ach", "owi", "ego", "emu", "ych", "ich", "ymi", "imi", "iej", "iom", "iow", "iem",
        "ej", "om", "ow", "em", "ie", "ia", "iu", "io", "ii",
        "a", "e", "i", "o", "u", "y",
    }.OrderByDescending(s => s.Length).ToArray();

    private readonly record struct Token(string Raw, string Stem);

    private readonly record struct Candidate(PantryItem Item, Token[][] NameTokens);

    public static string Normalize(string s)
    {
        if (string.IsNullOrWhiteSpace(s)) return "";
        s = FoldDiacritics(s.ToLowerInvariant());
        s = Regex.Replace(s, @"\(.*?(?:\)|$)", " ");    // drop "(z puszki)" etc., including a truncated suffix
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
        // Epenthetic -e- before -k in Polish genitive/nominative ("czosnek" ↔ "czosnku",
        // "jajek" ↔ "jajka"/"jajko", "bułek" ↔ "bułka"): fold "-ek" → "k" while keeping
        // the "-k" so "-k-" words never collapse into unrelated base nouns.
        if (w.Length >= 5 && w.EndsWith("ek", StringComparison.Ordinal))
            return string.Concat(w.AsSpan(0, w.Length - 2), "k");

        foreach (var end in Endings)
            if (w.Length - end.Length >= 3 && w.EndsWith(end, StringComparison.Ordinal))
                return w[..^end.Length];
        // English plural fallback ("tomatoes" -> "tomato", "bananas" -> "banana")
        if (w.Length > 4 && w.EndsWith("oes", StringComparison.Ordinal)) return w[..^2];
        if (w.Length > 3 && w.EndsWith('s') && !w.EndsWith("ss", StringComparison.Ordinal)) return w[..^1];
        return w;
    }

    private static Token[] Tokens(string s) =>
        Normalize(s).Split(' ', StringSplitOptions.RemoveEmptyEntries)
                    .Where(t => t.Length >= 2 && !Stopwords.Contains(t))
                    .Select(t => new Token(t, Stem(t)))
                    .ToArray();

    private static bool TokenMatch(Token a, Token b) =>
        a.Raw == b.Raw || a.Stem == b.Stem;

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
        var bestScore = 0;
        var bestRaw = -1;

        foreach (var p in pantry)
        {
            foreach (var candidate in NamesOf(p))
            {
                var pt = Tokens(candidate);
                if (pt.Length == 0) continue;
                Evaluate(ing, pt, minScore, p, ref best, ref bestScore, ref bestRaw);
            }
        }

        return best;
    }

    private static void Evaluate(Token[] ing, Token[] pt, int minScore, PantryItem p,
        ref PantryItem? best, ref int bestScore, ref int bestRaw)
    {
        // 1-to-1 token pairing: exact raw tokens first, then inflected stem matches.
        var usedIng = new bool[ing.Length];
        var usedPt = new bool[pt.Length];
        var matched = 0;
        var rawMatches = 0;

        for (var i = 0; i < ing.Length; i++)
        {
            for (var j = 0; j < pt.Length; j++)
            {
                if (!usedPt[j] && ing[i].Raw == pt[j].Raw)
                {
                    usedIng[i] = usedPt[j] = true;
                    matched++;
                    rawMatches++;
                    break;
                }
            }
        }
        for (var i = 0; i < ing.Length; i++)
        {
            if (usedIng[i]) continue;
            for (var j = 0; j < pt.Length; j++)
            {
                if (!usedPt[j] && TokenMatch(ing[i], pt[j]))
                {
                    usedIng[i] = usedPt[j] = true;
                    matched++;
                    break;
                }
            }
        }

        int score;
        if (rawMatches == pt.Length && rawMatches == ing.Length) score = 100;           // identical
        else if (matched == pt.Length && matched == ing.Length) score = 85;             // same thing, inflected
        else if (matched == pt.Length) score = 70 + pt.Length;                          // "czosnek" ⊆ "ząbki czosnku"
        else if (matched == ing.Length) score = 60 + ing.Length;                        // "ciecierzyca" ⊆ "ciecierzyca (z puszki)"
        else return;

        if (score < minScore) return;
        if (score > bestScore || (score == bestScore && rawMatches > bestRaw))
        {
            bestScore = score;
            bestRaw = rawMatches;
            best = p;
        }
    }

    /// <summary>
    /// Recomputes recipe ingredient links against the current pantry catalog using
    /// strict <see cref="ExactishScore"/> matching (consistent with
    /// <see cref="RecipeIngredientNormalizer"/>). The current link is evaluated first,
    /// so an equally good candidate does not cause churn, while a stronger match wins.
    /// </summary>
    public int RelinkIngredients(IEnumerable<RecipeIngredient> ingredients,
        IReadOnlyList<PantryItem> pantry)
    {
        var prepared = new List<Candidate>(pantry.Count);
        var byId = new Dictionary<Guid, Candidate>(pantry.Count);
        foreach (var p in pantry)
        {
            var tokenSets = NamesOf(p)
                .Select(Tokens)
                .Where(t => t.Length > 0)
                .ToArray();
            var cand = new Candidate(p, tokenSets);
            prepared.Add(cand);
            byId[p.Id] = cand;
        }

        var changed = 0;
        foreach (var ingredient in ingredients)
        {
            var ing = Tokens(ingredient.Name);
            PantryItem? bestMatch = null;
            if (ing.Length > 0)
            {
                var bestScore = 0;
                var bestRaw = -1;
                Guid? currentId = ingredient.PantryItemId;
                if (currentId is Guid cid && byId.TryGetValue(cid, out var current))
                {
                    foreach (var pt in current.NameTokens)
                        Evaluate(ing, pt, ExactishScore, current.Item, ref bestMatch, ref bestScore, ref bestRaw);
                }
                foreach (var cand in prepared)
                {
                    if (cand.Item.Id == currentId) continue;
                    foreach (var pt in cand.NameTokens)
                        Evaluate(ing, pt, ExactishScore, cand.Item, ref bestMatch, ref bestScore, ref bestRaw);
                }
            }

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
