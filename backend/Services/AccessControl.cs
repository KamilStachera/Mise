using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Mise.Api.Data;

namespace Mise.Api.Services;

/// <summary>
/// Deployment-wide access settings. Being privileged (allowed to write and to read the private
/// endpoints) is decided per request in <see cref="People.ResolveAsync"/>: a Google account that
/// belongs to a household, a personal API key, a short-lived per-turn Sous token, the internal
/// system key naming a person, or the local dev bypass. Everything else is read-only on
/// <see cref="PublicHouseholdId"/> (if set).
/// </summary>
public sealed class AccessControl
{
    public const string ApiKeyHeader = "X-Api-Key";
    public const string SousSecretHeader = "X-Sous-Secret";

    /// <summary>Personal keys start with this, so they're recognisable in configs and logs.</summary>
    public const string PersonalKeyPrefix = "pk_";

    /// <summary>Short-lived per-turn tokens minted by the API for Sous MCP calls.</summary>
    public const string SousTokenPrefix = "st_";

    private static readonly TimeSpan SousTokenLifetime = TimeSpan.FromMinutes(15);

    private readonly byte[]? _systemKey;
    private readonly HashSet<string> _adminEmails;
    private readonly ITimeLimitedDataProtector? _sousTokens;

    /// <summary>When true every request is privileged — local dev / verify runs only.</summary>
    public bool DevBypass { get; }

    /// <summary>Google OAuth is only wired up when a client id is configured.</summary>
    public bool GoogleConfigured { get; }

    /// <summary>The household anonymous visitors may browse read-only; null = they see nothing.</summary>
    public int? PublicHouseholdId { get; }

    /// <summary>Shared secret sent on internal API → Sous requests (X-Sous-Secret).</summary>
    public string? SousSecret { get; }

    public AccessControl(IConfiguration config, IDataProtectionProvider? protection = null)
    {
        // The internal key (MISE_API_KEY) is local/internal only. Unset ⇒ disabled (fail closed).
        var key = config["MISE_API_KEY"];
        _systemKey = string.IsNullOrWhiteSpace(key) ? null : Encoding.UTF8.GetBytes(key);

        var explicitSousSecret = config["SOUS_SECRET"]?.Trim();
        SousSecret = !string.IsNullOrEmpty(explicitSousSecret)
            ? explicitSousSecret
            : string.IsNullOrWhiteSpace(key)
                ? null
                : Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes("pichci-sous-internal:" + key))).ToLowerInvariant();

        _sousTokens = protection?.CreateProtector("Pichci.Sous.TurnToken.v1").ToTimeLimitedDataProtector();

        _adminEmails = (config["Auth:AdminEmails"] ?? "")
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        DevBypass = config.GetValue("Auth:DevBypass", false);
        GoogleConfigured = !string.IsNullOrWhiteSpace(config["Auth:Google:ClientId"]);
        PublicHouseholdId = int.TryParse(config["Auth:PublicHouseholdId"], out var pub) && pub > 0 ? pub : null;
    }

    public bool SystemKeyEnabled => _systemKey is not null;

    public bool IsSystemKey(string? candidate)
    {
        if (_systemKey is null || string.IsNullOrEmpty(candidate)) return false;
        return CryptographicOperations.FixedTimeEquals(_systemKey, Encoding.UTF8.GetBytes(candidate));
    }

    /// <summary>Admins (env <c>ADMIN_EMAILS</c>) create households and switch Sous on per household.</summary>
    public bool IsAdminEmail(string? email) => email is not null && _adminEmails.Contains(email);

    public bool IsPrivileged(HttpContext ctx) => ctx.RequestServices.GetRequiredService<Caller>().IsPrivileged;

    // ---- per-turn Sous tokens ----

    public sealed record SousToken(int HouseholdId, int PersonId);

    public string MintSousToken(int householdId, int personId)
    {
        if (_sousTokens is null)
            throw new InvalidOperationException("DataProtection is required to mint Sous turn tokens.");
        var nonce = Convert.ToHexString(RandomNumberGenerator.GetBytes(8));
        return SousTokenPrefix + _sousTokens.Protect($"{householdId}:{personId}:{nonce}", SousTokenLifetime);
    }

    public SousToken? ReadSousToken(string? key)
    {
        if (_sousTokens is null || string.IsNullOrEmpty(key) || !key.StartsWith(SousTokenPrefix, StringComparison.Ordinal))
            return null;
        try
        {
            var parts = _sousTokens.Unprotect(key[SousTokenPrefix.Length..]).Split(':');
            return parts.Length == 3 && int.TryParse(parts[0], out var h) && h > 0
                && int.TryParse(parts[1], out var p) && p > 0
                ? new SousToken(h, p)
                : null;
        }
        catch (CryptographicException)
        {
            return null;
        }
    }

    // ---- personal API keys ----

    public sealed record PersonalKeyMatch(Guid KeyId, PersonInfo Person);

    public static string NewPersonalKey() =>
        PersonalKeyPrefix + Convert.ToBase64String(RandomNumberGenerator.GetBytes(32))
            .TrimEnd('=').Replace('+', '-').Replace('/', '_');

    public static string HashKey(string key) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(key))).ToLowerInvariant();

    /// <summary>The live key's person (any household — this runs before the tenant is known), or null.</summary>
    public async Task<PersonalKeyMatch?> FindPersonalKeyAsync(MiseDbContext db, string key, CancellationToken ct = default)
    {
        if (!key.StartsWith(PersonalKeyPrefix, StringComparison.Ordinal)) return null;
        var hash = HashKey(key);
        var row = await db.ApiKeys.IgnoreQueryFilters().AsNoTracking()
            .Where(k => k.KeyHash == hash && k.RevokedAt == null)
            .Select(k => new { k.Id, k.PersonId })
            .FirstOrDefaultAsync(ct);
        if (row is null) return null;
        var person = await People.FindAsync(db, row.PersonId, ct);
        return person is null ? null : new PersonalKeyMatch(row.Id, person);
    }
}
