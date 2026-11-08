using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Mise.Api.Data;
using Mise.Api.Domain;

namespace Mise.Api.Services;

/// <summary>The person a request acts for — whose diary, goal, weight and band it touches.</summary>
public sealed record PersonScope(int Id)
{
    /// <summary>Services constructed without a request (unit tests) act for person 1.</summary>
    public static readonly PersonScope Default = new(1);
}

public sealed record PersonInfo(int Id, string Name, string? Email, int HouseholdId);

public enum CallerKind
{
    /// <summary>No session: read-only on the public household, if one is configured.</summary>
    Anonymous,
    /// <summary>Signed in with Google but not a member of any household yet (needs an invite code).</summary>
    Unlinked,
    /// <summary>Signed in and a member of a household.</summary>
    Member,
    /// <summary>A personal API key (agents/MCP): acts as the key's person.</summary>
    PersonalKey,
    /// <summary>The deployment's internal key (the Sous container): acts as the <c>X-Person</c> it names.</summary>
    SystemKey,
    /// <summary>Local development: everything allowed, <c>X-Person</c> may pick anyone.</summary>
    DevBypass,
}

/// <summary>
/// Who is calling, resolved once per request by <see cref="ApiAccessMiddleware"/> (which also points
/// the <see cref="TenantContext"/> at <see cref="HouseholdId"/>).
/// </summary>
public sealed class Caller
{
    public CallerKind Kind { get; set; } = CallerKind.Anonymous;
    public string? Email { get; set; }
    public string? Name { get; set; }
    public string? Picture { get; set; }
    /// <summary>The caller's own person (null for anonymous/unlinked).</summary>
    public PersonInfo? Self { get; set; }
    /// <summary>Whose data the request touches: <see cref="Self"/>, or the <c>X-Person</c> pick within the household.</summary>
    public PersonInfo? Acting { get; set; }
    public int? HouseholdId { get; set; }
    /// <summary>Everyone in <see cref="HouseholdId"/> (the person switcher).</summary>
    public IReadOnlyList<PersonInfo> People { get; set; } = [];
    public bool IsAdmin { get; set; }
    /// <summary>Id of the personal API key used, for last-used bookkeeping.</summary>
    public Guid? ApiKeyId { get; set; }

    /// <summary>Allowed to write and to read the private endpoints of <see cref="HouseholdId"/>.</summary>
    public bool IsPrivileged => Kind is CallerKind.Member or CallerKind.PersonalKey or CallerKind.SystemKey or CallerKind.DevBypass
        && Acting is not null;
}

/// <summary>Person lookups and the request → <see cref="Caller"/> resolution.</summary>
public static class People
{
    /// <summary>The switcher (and Sous/MCP via <c>MISE_PERSON</c>) sends this.</summary>
    public const string Header = "X-Person";

    public static string? NormalizeEmail(string? email) =>
        string.IsNullOrWhiteSpace(email) ? null : email.Trim().ToLowerInvariant();

    public static PersonInfo Info(Person p) => new(p.Id, p.Name, p.Email, p.HouseholdId);

    /// <summary>Lookups run before the tenant is known, so they bypass the household filter.</summary>
    public static async Task<PersonInfo?> FindAsync(MiseDbContext db, int id, CancellationToken ct = default) =>
        await db.People.IgnoreQueryFilters().AsNoTracking().Where(p => p.Id == id)
            .Select(p => new PersonInfo(p.Id, p.Name, p.Email, p.HouseholdId)).FirstOrDefaultAsync(ct);

    public static async Task<PersonInfo?> FindByEmailAsync(MiseDbContext db, string? email, CancellationToken ct = default)
    {
        var normalized = NormalizeEmail(email);
        if (normalized is null) return null;
        return await db.People.IgnoreQueryFilters().AsNoTracking().Where(p => p.Email == normalized)
            .Select(p => new PersonInfo(p.Id, p.Name, p.Email, p.HouseholdId)).FirstOrDefaultAsync(ct);
    }

    public static async Task<List<PersonInfo>> InHouseholdAsync(MiseDbContext db, int householdId, CancellationToken ct = default) =>
        await db.People.IgnoreQueryFilters().AsNoTracking().Where(p => p.HouseholdId == householdId)
            .OrderBy(p => p.Id)
            .Select(p => new PersonInfo(p.Id, p.Name, p.Email, p.HouseholdId)).ToListAsync(ct);

    /// <summary>
    /// Fills <paramref name="caller"/> and points the tenant at its household. Order: dev bypass →
    /// API key (personal, then system) → Google session → anonymous. <c>X-Person</c> is honoured
    /// only for privileged callers and only within their own household (dev bypass and the system
    /// key may name anyone: the system key is how Sous acts for whoever is chatting).
    /// </summary>
    public static async Task ResolveAsync(HttpContext ctx, MiseDbContext db, AccessControl access, Caller caller,
        CancellationToken ct = default)
    {
        int? picked = int.TryParse(ctx.Request.Headers[Header], out var p) ? p : null;
        var user = ctx.User;
        if (user.Identity?.IsAuthenticated == true)
        {
            caller.Email = NormalizeEmail(user.FindFirstValue(ClaimTypes.Email));
            caller.Name = user.FindFirstValue(ClaimTypes.Name);
            caller.Picture = user.FindFirstValue("picture");
        }

        var key = ctx.Request.Headers[AccessControl.ApiKeyHeader].ToString();
        if (access.DevBypass)
        {
            caller.Kind = CallerKind.DevBypass;
            caller.IsAdmin = true;
            // "Self" is the first person of whichever household the pick lands in, so a dev can
            // hop between households with the switcher header.
            var first = await db.People.IgnoreQueryFilters().AsNoTracking().OrderBy(x => x.Id)
                .Select(x => new PersonInfo(x.Id, x.Name, x.Email, x.HouseholdId)).FirstOrDefaultAsync(ct);
            var pick = picked is int id ? await FindAsync(db, id, ct) : null;
            caller.Self = pick is not null && pick.HouseholdId != first?.HouseholdId
                ? (await InHouseholdAsync(db, pick.HouseholdId, ct)).First()
                : first;
            caller.Acting = pick ?? caller.Self;
        }
        else if (key.Length > 0 && await access.FindPersonalKeyAsync(db, key, ct) is { } personal)
        {
            caller.Kind = CallerKind.PersonalKey;
            caller.ApiKeyId = personal.KeyId;
            caller.Self = personal.Person;
            caller.Acting = await PickWithinAsync(db, personal.Person, picked, ct);
        }
        else if (key.Length > 0 && access.IsSystemKey(key))
        {
            caller.Kind = CallerKind.SystemKey;
            // The internal key names its person explicitly; it never defaults to anyone.
            caller.Self = picked is int id ? await FindAsync(db, id, ct) : null;
            caller.Acting = caller.Self;
        }
        else if (caller.Email is not null)
        {
            caller.Self = await FindByEmailAsync(db, caller.Email, ct);
            caller.Kind = caller.Self is null ? CallerKind.Unlinked : CallerKind.Member;
            caller.Acting = caller.Self is null ? null : await PickWithinAsync(db, caller.Self, picked, ct);
            caller.IsAdmin = access.IsAdminEmail(caller.Email);
        }

        if (caller.Acting is { } acting)
        {
            caller.HouseholdId = acting.HouseholdId;
        }
        else if (caller.Kind is CallerKind.Anonymous or CallerKind.Unlinked && access.PublicHouseholdId is int pub)
        {
            // Read-only visitors browse the public household; "their" diary is its first person's.
            caller.HouseholdId = pub;
            caller.Acting = (await InHouseholdAsync(db, pub, ct)).FirstOrDefault();
        }

        if (caller.HouseholdId is int household)
        {
            db.Tenant.UseHousehold(household);
            if (caller.IsPrivileged) caller.People = await InHouseholdAsync(db, household, ct);
        }
    }

    private static async Task<PersonInfo> PickWithinAsync(MiseDbContext db, PersonInfo self, int? picked, CancellationToken ct)
    {
        if (picked is not int id || id == self.Id) return self;
        var other = await FindAsync(db, id, ct);
        return other is not null && other.HouseholdId == self.HouseholdId ? other : self;
    }

    /// <summary>
    /// Bridge from the single-household config, run on every boot (idempotent): <c>DIARY_PEOPLE</c>
    /// (<c>Name:email,…</c>, order = person id) names/links household 1's existing people, and every
    /// <c>AUTH_ALLOWED_EMAILS</c> or <c>ADMIN_EMAILS</c> address that still has no person gets a new
    /// one in household 1 (so the owner of a fresh install can sign in and invite people). Never
    /// guesses which emailless person an address belongs to.
    /// </summary>
    public static async Task ImportLegacyConfigAsync(MiseDbContext db, IConfiguration config, ILogger logger,
        CancellationToken ct = default)
    {
        var entries = (config["Diary:People"] ?? "")
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select((part, i) =>
            {
                var colon = part.IndexOf(':');
                var name = (colon < 0 ? part : part[..colon]).Trim();
                return (Id: i + 1, Name: name.Length > 0 ? name : $"Osoba {i + 1}",
                    Email: NormalizeEmail(colon < 0 ? null : part[(colon + 1)..]));
            })
            .ToList();
        var allowed = $"{config["Auth:AllowedEmails"]},{config["Auth:AdminEmails"]}"
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(NormalizeEmail).OfType<string>().Distinct().ToList();
        if (entries.Count == 0 && allowed.Count == 0) return;

        var people = await db.People.IgnoreQueryFilters().ToListAsync(ct);
        bool Taken(string email) => people.Any(x => x.Email == email);

        foreach (var entry in entries)
        {
            var row = people.FirstOrDefault(x => x.Id == entry.Id && x.HouseholdId == 1);
            if (row is null)
            {
                if (entry.Email is not null && Taken(entry.Email)) continue;
                row = new Person { HouseholdId = 1, Name = entry.Name, Email = entry.Email };
                db.People.Add(row);
                people.Add(row);
                logger.LogInformation("DIARY_PEOPLE: added {Name} to household 1", entry.Name);
                continue;
            }
            if (row.Email is null && entry.Email is not null && !Taken(entry.Email))
            {
                row.Email = entry.Email;
                logger.LogInformation("DIARY_PEOPLE: linked {Email} to person {Id}", entry.Email, row.Id);
            }
            if (row.Name is "Ja" or "" && entry.Name != row.Name) row.Name = entry.Name;
        }

        foreach (var email in allowed.Where(e => !Taken(e)))
        {
            var name = email.Split('@')[0];
            var row = new Person { HouseholdId = 1, Name = name.Length > 60 ? name[..60] : name, Email = email };
            db.People.Add(row);
            people.Add(row);
            logger.LogInformation("AUTH_ALLOWED_EMAILS/ADMIN_EMAILS: added {Email} to household 1 as a new person", email);
        }
        await db.SaveChangesAsync(ct);
    }
}
