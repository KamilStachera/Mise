using System.Text.RegularExpressions;
using Mise.Api.Domain;
using Mise.Api.Features;

namespace Mise.Api.Services;

/// <summary>
/// Enforces the recipe ingredient write contract for UI, REST and MCP callers.
/// Exact catalog names and aliases become the stored identity; source wording is
/// retained separately for presentation. Deliberately avoids loose fuzzy matches
/// when assigning PantryItemId so a plausible substring cannot merge products.
/// </summary>
public sealed partial class RecipeIngredientNormalizer(IngredientMatcher matcher)
{
    public static bool ContainsCombinedProductSyntax(string name) =>
        CombinedProductPattern().IsMatch(name ?? "");

    public RecipeIngredient Create(IngredientInput input,
        IReadOnlyList<PantryItem> pantry, int order)
    {
        var originalName = input.Name.Trim();
        var name = originalName;
        var quantity = input.Quantity?.Trim() ?? "";
        var displayText = string.IsNullOrWhiteSpace(input.DisplayText)
            ? null
            : input.DisplayText.Trim();

        // Protect REST/MCP callers that accidentally send the complete source line
        // as name. UI paste import already performs the same split client-side.
        if (quantity.Length == 0 && TrySplitQuantityPrefix(originalName,
                out var splitQuantity, out var splitName))
        {
            quantity = splitQuantity;
            name = splitName;
            displayText ??= originalName;
        }
        else if (quantity.Length > 0
                 && originalName.StartsWith(quantity + " ",
                     StringComparison.OrdinalIgnoreCase))
        {
            // Old imports sometimes duplicated the amount in both fields, e.g.
            // quantity="Odrobina", name="odrobina kremu balsamicznego (...)".
            name = originalName[(quantity.Length + 1)..].Trim();
            displayText ??= originalName;
        }

        // Only a full-name/alias or inflectional match may change identity. The
        // lower fuzzy threshold is useful for suggestions, but unsafe for writes
        // (for example "orzeszki ziemne" must never become "ziemniaki").
        var catalogItem = matcher.FindMatch(name, pantry, IngredientMatcher.ExactishScore);
        var storedName = catalogItem?.Name ?? name;

        if (displayText is null
            && !string.Equals(storedName, originalName, StringComparison.Ordinal))
        {
            displayText = string.Join(' ', new[] { quantity, originalName }
                .Where(x => !string.IsNullOrWhiteSpace(x)));
        }

        decimal? amountValue = null;
        PantryUnit? amountUnit = null;
        if (input.AmountValue is > 0
            && Mapping.TryParseUnit(input.AmountUnit, out var explicitUnit)
            && explicitUnit is PantryUnit unit)
        {
            (amountValue, amountUnit) = (input.AmountValue, unit);
        }
        else if (QuantityParser.TryParse(quantity, out var parsedValue, out var parsedUnit))
        {
            (amountValue, amountUnit) = (parsedValue, parsedUnit);
        }

        return new RecipeIngredient
        {
            Name = storedName,
            Quantity = quantity,
            DisplayText = displayText,
            AlternativeGroup = string.IsNullOrWhiteSpace(input.AlternativeGroup)
                ? null
                : input.AlternativeGroup.Trim(),
            Order = order,
            AmountValue = amountValue,
            AmountUnit = amountUnit,
            PantryItemId = catalogItem?.Id,
        };
    }

    private static bool TrySplitQuantityPrefix(string text,
        out string quantity, out string name)
    {
        var match = QuantityPrefixPattern().Match(text);
        if (!match.Success)
        {
            quantity = "";
            name = text;
            return false;
        }

        quantity = match.Groups["quantity"].Value.Trim();
        name = match.Groups["name"].Value.Trim();
        return name.Length > 0;
    }

    [GeneratedRegex(
        @"^\s*(?<quantity>(?:\d+(?:[.,]\d+)?|\d+\s*/\s*\d+|[¼½¾⅓⅔⅛⅜⅝⅞])(?:\s*[–—-]\s*(?:\d+(?:[.,]\d+)?|\d+\s*/\s*\d+|[¼½¾⅓⅔⅛⅜⅝⅞]))?\s*(?:kg|dag|dkg|g|ml|l|szt(?:\.|uk\p{L}*)?|kromk\p{L}*|łyżeczk\p{L}*|łyżk\p{L}*|garś\p{L}*|szczypt\p{L}*|puszk\p{L}*|opakowa\p{L}*|paczk\p{L}*|ząbk\p{L}*|plastr\p{L}*|gałązk\p{L}*|pęcz\p{L}*|porcj\p{L}*|główk\p{L}*)(?:\s*\([^)]*\))?)\s+(?<name>.+?)\s*$",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex QuantityPrefixPattern();

    [GeneratedRegex(@"(?:\s/\s|\b(?:lub|albo)\b)",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex CombinedProductPattern();
}
