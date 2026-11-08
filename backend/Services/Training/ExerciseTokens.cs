using System.Text.RegularExpressions;

namespace Mise.Api.Services.Training;

/// <summary>
/// Training enums travel as kebab-case tokens ("middle-back", "body-only", "ez-bar").
/// Parsing is tolerant of case, '-', '_' and spaces, so upstream strings ("lower back")
/// and agent input map the same way; numeric strings are never accepted.
/// </summary>
public static partial class ExerciseTokens
{
    public static string Of<T>(T value) where T : struct, Enum
        => Kebab().Replace(value.ToString(), "$1-$2").ToLowerInvariant();

    public static string? Of<T>(T? value) where T : struct, Enum
        => value is { } v ? Of(v) : null;

    public static IReadOnlyList<string> All<T>() where T : struct, Enum
        => Enum.GetValues<T>().Select(v => Of(v)).ToArray();

    public static bool TryParse<T>(string? s, out T value) where T : struct, Enum
    {
        value = default;
        if (string.IsNullOrWhiteSpace(s)) return false;
        var token = s.Trim().Replace("-", "").Replace("_", "").Replace(" ", "");
        if (token.Length == 0 || char.IsAsciiDigit(token[0])) return false;
        return Enum.TryParse(token, ignoreCase: true, out value) && Enum.IsDefined(value);
    }

    /// <summary>Muscle tokens/names → enum names as stored; false on the first unknown one.</summary>
    public static bool TryParseMuscles(IEnumerable<string>? tokens, out List<string> names)
    {
        names = [];
        foreach (var t in tokens ?? [])
        {
            if (!TryParse<Domain.Muscle>(t, out var m)) return false;
            var name = m.ToString();
            if (!names.Contains(name)) names.Add(name);
        }
        return true;
    }

    /// <summary>Stored muscle enum names → API tokens (unknown names are dropped).</summary>
    public static List<string> MuscleTokens(IEnumerable<string> stored)
        => stored.Select(n => TryParse<Domain.Muscle>(n, out var m) ? Of(m) : null)
            .OfType<string>().ToList();

    [GeneratedRegex("([a-z])([A-Z])")]
    private static partial Regex Kebab();
}
