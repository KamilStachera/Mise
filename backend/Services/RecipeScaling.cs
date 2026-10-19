using System.Globalization;
using System.Text.RegularExpressions;
using Mise.Api.Domain;

namespace Mise.Api.Services;

/// <summary>
/// Portion scaling. The recipe is stored as written for <see cref="Recipe.Servings"/>;
/// the recipe screen shows it for <see cref="EffectiveServings"/> — the saved
/// <see cref="Recipe.SelectedServings"/>, or one portion (one person) when nothing was
/// chosen. Their ratio is applied to ingredient amounts wherever quantities matter:
/// recipe detail, missing/to-buy checks, the cook proposal and shopping-list demand.
/// Scaling always works on copies — the stored recipe keeps its amounts as written.
/// </summary>
public static partial class RecipeScaling
{
    /// <summary>Upper bound of the portion picker; recipes written for more keep their base reachable.</summary>
    public const int MaxServings = 8;

    /// <summary>Portions shown until someone picks another count: one portion = one person.</summary>
    public const int DefaultServings = 1;

    private static readonly CultureInfo Pl = CultureInfo.GetCultureInfo("pl-PL");

    // Numbers inside quantity strings, including "1,5", "1.5" and fractions "1/2".
    [GeneratedRegex(@"\d+(?:[.,]\d+)?(?:\s*/\s*\d+)?", RegexOptions.CultureInvariant)]
    private static partial Regex NumberPattern();

    public static int EffectiveServings(Recipe r) => r.SelectedServings ?? DefaultServings;

    public static bool IsScaled(Recipe r) => r.Servings > 0 && EffectiveServings(r) != r.Servings;

    /// <summary>
    /// The recipe's ingredients with amounts multiplied by selected/base servings.
    /// Unscaled recipes return the original list; otherwise detached copies.
    /// </summary>
    public static List<RecipeIngredient> ScaledIngredients(Recipe r) =>
        IsScaled(r) ? ScaleIngredients(r, EffectiveServings(r)) : r.Ingredients;

    /// <summary>Shallow copy carrying scaled ingredients, for consumers that take a whole recipe.</summary>
    public static Recipe Scaled(Recipe r) => IsScaled(r) ? WithIngredients(r, ScaledIngredients(r)) : r;

    /// <summary>
    /// The recipe scaled to an explicit portion count — a pot's size or a plan entry's
    /// ×0,5 / ×1 / ×1,5 — ignoring SelectedServings.
    /// </summary>
    public static Recipe ScaledTo(Recipe r, decimal portions) =>
        r.Servings > 0 && portions > 0 && portions != r.Servings
            ? WithIngredients(r, ScaleIngredients(r, portions))
            : r;

    private static Recipe WithIngredients(Recipe r, List<RecipeIngredient> ingredients) => new()
    {
        Id = r.Id,
        Title = r.Title,
        Servings = r.Servings,
        SelectedServings = r.SelectedServings,
        Ingredients = ingredients,
    };

    private static List<RecipeIngredient> ScaleIngredients(Recipe r, decimal portions) =>
        r.Ingredients.Select(i => new RecipeIngredient
        {
            Id = i.Id,
            RecipeId = i.RecipeId,
            Name = i.Name,
            Quantity = ScaleText(i.Quantity, portions, r.Servings),
            DisplayText = i.DisplayText is null ? null : ScaleText(i.DisplayText, portions, r.Servings),
            AlternativeGroup = i.AlternativeGroup,
            Order = i.Order,
            AmountValue = i.AmountValue is decimal v ? Scale(v, portions, r.Servings) : null,
            AmountUnit = i.AmountUnit,
            PantryItemId = i.PantryItemId,
        }).ToList();

    /// <summary>Multiply before dividing — 3 szt at 3→2 servings must come out exactly 2.</summary>
    private static decimal Scale(decimal value, decimal selected, int servings) =>
        Math.Round(value * selected / servings, 2);

    /// <summary>
    /// Rewrites every number in a display string ("100 g" ×2 → "200 g",
    /// "1/2 szklanki" ×2 → "1 szklanki", "2–4 kromki" ×2 → "4–8 kromki").
    /// Percentages and degrees ("mleko 2%", "180°C") are left alone; strings
    /// without numbers ("garść", "do smaku") come back unchanged.
    /// </summary>
    public static string ScaleText(string text, decimal selected, int servings)
    {
        if (string.IsNullOrWhiteSpace(text) || servings <= 0) return text;
        return NumberPattern().Replace(text, m =>
        {
            var next = m.Index + m.Length < text.Length ? text[m.Index + m.Length] : '\0';
            if (next is '%' or '°') return m.Value;
            if (!TryParseNumber(m.Value, out var value)) return m.Value;
            return Scale(value, selected, servings).ToString("0.##", Pl);
        });
    }

    private static bool TryParseNumber(string token, out decimal value)
    {
        value = 0;
        var slash = token.IndexOf('/');
        if (slash > 0)
        {
            var a = token[..slash].Trim().Replace(',', '.');
            var b = token[(slash + 1)..].Trim();
            if (!decimal.TryParse(a, NumberStyles.Number, CultureInfo.InvariantCulture, out var numerator)
                || !decimal.TryParse(b, NumberStyles.Number, CultureInfo.InvariantCulture, out var denominator)
                || denominator == 0)
                return false;
            value = numerator / denominator;
            return true;
        }
        return decimal.TryParse(token.Replace(',', '.'), NumberStyles.Number,
            CultureInfo.InvariantCulture, out value);
    }
}
