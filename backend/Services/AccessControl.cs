using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;

namespace Mise.Api.Services;

/// <summary>
/// Central access rules for the public deployment. Three ways to be privileged
/// (= allowed to mutate and to read the private endpoints):
/// a whitelisted Google session cookie, the X-Api-Key header (agents/MCP),
/// or the local dev bypass. Everything else is anonymous read-only.
/// </summary>
public sealed class AccessControl
{
    public const string ApiKeyHeader = "X-Api-Key";

    private readonly byte[]? _apiKey;
    private readonly HashSet<string> _allowedEmails;

    /// <summary>When true every request is privileged — local dev / verify runs only.</summary>
    public bool DevBypass { get; }

    /// <summary>Google OAuth is only wired up when a client id is configured.</summary>
    public bool GoogleConfigured { get; }

    public AccessControl(IConfiguration config)
    {
        // Unset key ⇒ key auth disabled entirely (fail closed), never "any value works".
        var key = config["MISE_API_KEY"];
        _apiKey = string.IsNullOrWhiteSpace(key) ? null : Encoding.UTF8.GetBytes(key);

        _allowedEmails = (config["Auth:AllowedEmails"] ?? "")
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        DevBypass = config.GetValue("Auth:DevBypass", false);
        GoogleConfigured = !string.IsNullOrWhiteSpace(config["Auth:Google:ClientId"]);
    }

    public bool ApiKeyEnabled => _apiKey is not null;

    public bool IsValidApiKey(string? candidate)
    {
        if (_apiKey is null || string.IsNullOrEmpty(candidate)) return false;
        return CryptographicOperations.FixedTimeEquals(_apiKey, Encoding.UTF8.GetBytes(candidate));
    }

    /// <summary>
    /// Re-checked on every request (not only at sign-in) so removing an email from
    /// the whitelist locks the account out immediately, not at cookie expiry.
    /// </summary>
    public bool IsAllowedEmail(string? email) =>
        email is not null && _allowedEmails.Contains(email);

    public bool IsPrivileged(HttpContext ctx)
    {
        if (DevBypass) return true;
        if (IsValidApiKey(ctx.Request.Headers[ApiKeyHeader])) return true;
        return ctx.User.Identity?.IsAuthenticated == true
            && IsAllowedEmail(ctx.User.FindFirstValue(ClaimTypes.Email));
    }
}
