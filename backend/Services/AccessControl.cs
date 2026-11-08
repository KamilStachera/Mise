using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Mise.Api.Data;

namespace Mise.Api.Services;

/// <summary>
/// Deployment-wide access settings. Being privileged (allowed to write and to read the private
/// endpoints) is decided per request in <see cref="People.ResolveAsync"/>: a Google account that
/// belongs to a household, a personal API key, the internal system key naming a person, or the
/// local dev bypass. Everything else is read-only on <see cref="PublicHouseholdId"/> (if set).
/// </summary>
public sealed class AccessControl
{
    public const string ApiKeyHeader = "X-Api-Key";

    /// <summary>Personal keys start with this, so they're recognisable in configs and logs.</summary>
    public const string PersonalKeyPrefix = "pk_";

    private readonly byte[]? _systemKey;
    private readonly HashSet<string> _adminEmails;

    /// <summary>When true every request is privileged — local dev / verify runs only.</summary>
    public bool DevBypass { get; }

    /// <summary>Google OAuth is only wired up when a client id is configured.</summary>
    public bool GoogleConfigured { get; }

    /// <summary>The household anonymous visitors may browse read-only; null = they see nothing.</summary>
    public int? PublicHouseholdId { get; }

    public AccessControl(IConfiguration config)
    {
        // The internal key (MISE_API_KEY) is for the Sous container. Unset ⇒ disabled (fail closed).
        var key = config["MISE_API_KEY"];
        _systemKey = string.IsNullOrWhiteSpace(key) ? null : Encoding.UTF8.GetBytes(key);

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
