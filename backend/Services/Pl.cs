using System.Globalization;

namespace Mise.Api.Services;

/// <summary>Polish-collation string comparer for user-facing sorting (Ł between L and M, etc.).</summary>
public static class Pl
{
    public static readonly StringComparer Comparer =
        StringComparer.Create(CultureInfo.GetCultureInfo("pl-PL"), ignoreCase: true);
}
