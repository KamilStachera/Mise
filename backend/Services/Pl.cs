using System.Globalization;
using System.Text;

namespace Mise.Api.Services;

/// <summary>Polish-collation string comparer for user-facing sorting (Ł between L and M, etc.).</summary>
public static class Pl
{
    public static readonly CultureInfo Culture = CultureInfo.GetCultureInfo("pl-PL");

    public static readonly StringComparer Comparer =
        StringComparer.Create(Culture, ignoreCase: true);

    /// <summary>Lowercase + Polish diacritic folding for diacritic-insensitive search ("twarog" ↔ "Twaróg").</summary>
    public static string Fold(string? s)
    {
        if (string.IsNullOrEmpty(s)) return "";
        var lower = s.ToLower(Culture);
        var sb = new StringBuilder(lower.Length);
        foreach (var ch in lower)
            sb.Append(ch switch
            {
                'ą' => 'a', 'ć' => 'c', 'ę' => 'e', 'ł' => 'l', 'ń' => 'n',
                'ó' => 'o', 'ś' => 's', 'ź' => 'z', 'ż' => 'z',
                _ => ch,
            });
        return sb.ToString();
    }
}
