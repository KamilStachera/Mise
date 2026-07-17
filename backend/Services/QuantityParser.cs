using System.Globalization;
using System.Text.RegularExpressions;
using Mise.Api.Domain;

namespace Mise.Api.Services;

/// <summary>
/// Parses a free-text ingredient quantity ("100 g", "1,5 l", "2 szt", "1/2", "4")
/// into a value in one of the canonical pantry units. Deliberately narrow: kitchen
/// measures ("2 łyżki", "garść", "1 puszka") are NOT guessed — they return false and
/// the caller falls back to presence-based logic / skips the deduction.
/// </summary>
public static partial class QuantityParser
{
    [GeneratedRegex(@"^\s*(?<num>\d+(?:[.,]\d+)?|\d+\s*/\s*\d+)\s*(?<unit>kg|dag|dkg|g|ml|l|szt\w*|sztuk\w*)?\.?\s*$",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex Pattern();

    [GeneratedRegex(@"\(\s*(?<num>\d+(?:[.,]\d+)?|\d+\s*/\s*\d+)\s*(?<unit>kg|dag|dkg|g|ml|l|szt\w*|sztuk\w*)\.?\s*\)",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex ParentheticalAmountPattern();

    [GeneratedRegex(@"\d+(?:[.,]\d+)?\s*[–—-]\s*\d+(?:[.,]\d+)?",
        RegexOptions.CultureInvariant)]
    private static partial Regex RangePattern();

    public static bool TryParse(string? text, out decimal value, out PantryUnit unit)
    {
        value = 0;
        unit = PantryUnit.Szt;
        if (string.IsNullOrWhiteSpace(text)) return false;

        var m = Pattern().Match(text);
        if (!m.Success)
        {
            // A single exact metric/count value in parentheses is safe and common
            // in recipe prose: "1 porcja (120 g)" or "3 kromki (105 g)". Ranges
            // remain deliberately unquantified.
            if (RangePattern().IsMatch(text)) return false;
            var matches = ParentheticalAmountPattern().Matches(text);
            if (matches.Count != 1) return false;
            m = matches[0];
        }

        var num = m.Groups["num"].Value.Replace(" ", "");
        decimal n;
        var slash = num.IndexOf('/');
        if (slash > 0)
        {
            var a = decimal.Parse(num[..slash], CultureInfo.InvariantCulture);
            var b = decimal.Parse(num[(slash + 1)..], CultureInfo.InvariantCulture);
            if (b == 0) return false;
            n = a / b;
        }
        else
        {
            n = decimal.Parse(num.Replace(',', '.'), CultureInfo.InvariantCulture);
        }

        var token = m.Groups["unit"].Value.ToLowerInvariant();
        (value, unit) = token switch
        {
            "kg" => (n * 1000, PantryUnit.G),
            "dag" or "dkg" => (n * 10, PantryUnit.G),
            "g" => (n, PantryUnit.G),
            "l" => (n * 1000, PantryUnit.Ml),
            "ml" => (n, PantryUnit.Ml),
            // bare number ("4" jajka, "2" dymki) or szt/sztuki
            _ => (n, PantryUnit.Szt),
        };
        return value > 0;
    }

    /// <summary>
    /// Converts a foreign-unit amount to <paramref name="target"/> when there is an
    /// exact metric conversion (kg/dag→g, l→ml); identity when units already agree.
    /// </summary>
    public static bool TryConvert(decimal value, string? unitToken, PantryUnit target, out decimal converted)
    {
        converted = value;
        var token = (unitToken ?? "").Trim().ToLowerInvariant().TrimEnd('.');
        if (token.Length == 0) return true;   // no unit given — trust the caller
        (decimal factor, PantryUnit canonical)? parsed = token switch
        {
            "kg" => (1000m, PantryUnit.G),
            "dag" or "dkg" => (10m, PantryUnit.G),
            "g" => (1m, PantryUnit.G),
            "l" => (1000m, PantryUnit.Ml),
            "ml" => (1m, PantryUnit.Ml),
            _ when token.StartsWith("szt", StringComparison.Ordinal) => (1m, PantryUnit.Szt),
            _ => null,
        };
        if (parsed is not { } p || p.canonical != target) return false;
        converted = value * p.factor;
        return true;
    }
}
