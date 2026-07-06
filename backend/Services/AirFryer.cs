using System.Text.RegularExpressions;
using Mise.Api.Domain;

namespace Mise.Api.Services;

/// <summary>
/// Resolves whether a recipe is cooked in the air-fryer: the stored flag wins;
/// recipes saved before the flag existed (null) fall back to a text heuristic.
/// </summary>
public static class AirFryer
{
    private static readonly string[] Tokens = ["frytkownic", "airfryer", "air fryer", "air-fryer"];
    private static readonly Regex Negation =
        new(@"\b(nie|bez|no|not)\b", RegexOptions.IgnoreCase | RegexOptions.Compiled);

    /// <summary>Requires Steps to be loaded when the stored flag is null.</summary>
    public static bool Uses(Recipe r) => r.UsesAirFryer ?? Heuristic(r);

    /// <summary>
    /// Title, blurb or steps mentioning an air-fryer count. The tip counts too,
    /// but only per sentence without a negation — tips like "To nie danie do
    /// frytkownicy" must not match, while "Świetnie wychodzi też we frytkownicy" must.
    /// </summary>
    private static bool Heuristic(Recipe r)
    {
        if (Mentions(r.Title) || Mentions(r.Blurb) || r.Steps.Any(s => Mentions(s.Text)))
            return true;
        return r.Tip is not null && r.Tip
            .Split(['.', '!', '?'], StringSplitOptions.RemoveEmptyEntries)
            .Any(s => Mentions(s) && !Negation.IsMatch(s));
    }

    private static bool Mentions(string text)
        => Tokens.Any(t => text.Contains(t, StringComparison.OrdinalIgnoreCase));
}
