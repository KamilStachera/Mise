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

    /// <summary>
    /// Portions the recipe screen shows. With <paramref name="fixedIngredients"/>
    /// (<see cref="Household.KeepIngredientsFixed"/>) it is always the whole recipe, so nothing scales.
    /// </summary>
    public static int EffectiveServings(Recipe r, bool fixedIngredients = false) =>
        fixedIngredients ? Math.Max(1, r.Servings) : r.SelectedServings ?? DefaultServings;

    public static bool IsScaled(Recipe r, bool fixedIngredients = false) =>
        r.Servings > 0 && EffectiveServings(r, fixedIngredients) != r.Servings;

    /// <summary>
    /// The recipe's ingredients with amounts multiplied by selected/base servings.
    /// Unscaled recipes return the original list; otherwise detached copies.
    /// </summary>
    public static List<RecipeIngredient> ScaledIngredients(Recipe r, bool fixedIngredients = false) =>
        IsScaled(r, fixedIngredients) ? ScaleIngredients(r, EffectiveServings(r, fixedIngredients)) : r.Ingredients;

    /// <summary>Shallow copy carrying scaled ingredients, for consumers that take a whole recipe.</summary>
    public static Recipe Scaled(Recipe r, bool fixedIngredients = false) =>
        IsScaled(r, fixedIngredients) ? WithIngredients(r, ScaledIngredients(r, fixedIngredients)) : r;

    /// <summary>Most portions a dish may be split into (PUT /recipes/{id}/portion-count).</summary>
    public const int MaxPortionCount = 200;

    /// <summary>
    /// Splits the same dish into <paramref name="portions"/> portions: ingredients stay as written
    /// (they are the whole dish), per-portion kcal/macros are re-divided so the dish total holds
    /// (e.g. 4 × 600 kcal → 6 × 400 kcal). Eaten diary entries keep their snapshots; planned
    /// ones follow the new per-portion numbers.
    /// </summary>
    public static void Resplit(Recipe r, int portions)
    {
        var old = Math.Max(1, r.Servings);
        if (portions == old) return;
        decimal Ratio(decimal v) => v * old / portions;
        if (r.KcalPerServing is int kcal)
            r.KcalPerServing = Math.Max(1, (int)Math.Round(Ratio(kcal), MidpointRounding.AwayFromZero));
        if (r.ProteinGrams is decimal p) r.ProteinGrams = Math.Round(Ratio(p), 1, MidpointRounding.AwayFromZero);
        if (r.FatGrams is decimal f) r.FatGrams = Math.Round(Ratio(f), 1, MidpointRounding.AwayFromZero);
        if (r.CarbGrams is decimal c) r.CarbGrams = Math.Round(Ratio(c), 1, MidpointRounding.AwayFromZero);
        r.Servings = portions;
        // The picker's choice counts people eating; drop it only when it no longer fits the range.
        if (r.SelectedServings > Math.Max(MaxServings, r.Servings)) r.SelectedServings = null;
    }

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
    private static decimal Scale(decimal value, decimal selected, int servings)
    {
        try { return Math.Round(value * selected / servings, 2); }
        catch (OverflowException) { return value; }
    }

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
            if (!TryParseNumber(m.Value, out var value) || Math.Abs(value) > 1_000_000_000m) return m.Value;
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
            try { value = numerator / denominator; }
            catch (OverflowException) { return false; }
            return true;
        }
        return decimal.TryParse(token.Replace(',', '.'), NumberStyles.Number,
            CultureInfo.InvariantCulture, out value);
    }
}
