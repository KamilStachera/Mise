using System.Security.Cryptography;
using System.Text;

namespace Mise.Api.Services;

/// <summary>
/// Invite codes: 10 Crockford base32 characters (~50 bits) shown as <c>XXXXX-XXXXX</c>. Typing is
/// forgiving — case, dashes and spaces don't matter, and O/I/L read as 0/1. Only the SHA-256 of
/// the normalized code is stored; redemption is rate-limited.
/// </summary>
public static class Invites
{
    public static readonly TimeSpan Lifetime = TimeSpan.FromDays(7);

    private const string Alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

    public static string NewCode()
    {
        Span<char> chars = stackalloc char[10];
        for (var i = 0; i < chars.Length; i++) chars[i] = Alphabet[RandomNumberGenerator.GetInt32(Alphabet.Length)];
        return $"{chars[..5]}-{chars[5..]}";
    }

    /// <summary>Upper-cased, separators dropped, look-alikes folded; null when it can't be a code.</summary>
    public static string? Normalize(string? input)
    {
        if (string.IsNullOrWhiteSpace(input)) return null;
        var sb = new StringBuilder();
        foreach (var raw in input.ToUpperInvariant())
        {
            var c = raw switch { 'O' => '0', 'I' or 'L' => '1', _ => raw };
            if (c is '-' or ' ') continue;
            if (!Alphabet.Contains(c)) return null;
            sb.Append(c);
        }
        return sb.Length == 10 ? sb.ToString() : null;
    }

    public static string Hash(string normalized) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(normalized))).ToLowerInvariant();
}
