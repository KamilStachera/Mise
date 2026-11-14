using System.Linq.Expressions;
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

/// <param name="Blocked">The person or their whole household is blocked.</param>
public sealed record PersonInfo(int Id, string Name, string? Email, int HouseholdId,
    HouseholdRole Role = HouseholdRole.Member, bool IsAdmin = false, bool Blocked = false);

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
    /// <summary>A blocked person (or a member of a blocked household): only <c>/api/auth</c> answers.</summary>
    Blocked,
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

    /// <summary>May invite people, rename the household and change roles in it.</summary>
    public bool IsOwner => IsPrivileged && (IsAdmin || Self?.Role == HouseholdRole.Owner);
}

/// <summary>Person lookups and the request → <see cref="Caller"/> resolution.</summary>
public static class People
{
    /// <summary>The switcher (and Sous/MCP via <c>MISE_PERSON</c>) sends this.</summary>
    public const string Header = "X-Person";

    public static string? NormalizeEmail(string? email) =>
        string.IsNullOrWhiteSpace(email) ? null : email.Trim().ToLowerInvariant();

    /// <summary>
    /// Every person lookup goes through here (and bypasses the household filter: they run before
    /// the tenant is known). <c>Blocked</c> includes a blocked household. Filter and order on the
    /// entity BEFORE the projection: SQL providers can't translate a <c>Where</c> over the
    /// constructor-projected <see cref="PersonInfo"/> (EF InMemory can, so tests alone won't catch it —
    /// <c>TenancyTests</c> checks the SQL translation).
    /// </summary>
    public static IQueryable<PersonInfo> Query(MiseDbContext db, Expression<Func<Person, bool>> filter) =>
        db.People.IgnoreQueryFilters().AsNoTracking().Where(filter).OrderBy(p => p.Id)
            .Select(p => new PersonInfo(p.Id, p.Name, p.Email, p.HouseholdId, p.Role, p.IsAdmin,
                p.BlockedAt != null || db.Households.Any(h => h.Id == p.HouseholdId && h.BlockedAt != null)));

    public static Task<PersonInfo?> FindAsync(MiseDbContext db, int id, CancellationToken ct = default) =>
        Query(db, p => p.Id == id).FirstOrDefaultAsync(ct);

    public static async Task<PersonInfo?> FindByEmailAsync(MiseDbContext db, string? email, CancellationToken ct = default)
    {
        var normalized = NormalizeEmail(email);
        if (normalized is null) return null;
        return await Query(db, p => p.Email == normalized).FirstOrDefaultAsync(ct);
    }

    public static Task<List<PersonInfo>> InHouseholdAsync(MiseDbContext db, int householdId, CancellationToken ct = default) =>
        Query(db, p => p.HouseholdId == householdId).ToListAsync(ct);

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
            var first = await Query(db, _ => true).FirstOrDefaultAsync(ct);
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
            // Admin = the DB flag, or ADMIN_EMAILS (the can't-lock-yourself-out fallback). API keys
            // never carry admin rights.
            caller.IsAdmin = caller.Self?.IsAdmin == true || access.IsAdminEmail(caller.Email);
        }

        // Blocked people (or households) keep their identity for /auth/me, nothing else.
        if (caller.Self?.Blocked == true || caller.Acting?.Blocked == true)
        {
            caller.Kind = CallerKind.Blocked;
            caller.Acting = null;
            caller.IsAdmin = false;
            caller.ApiKeyId = null;
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

    public const string LegacyImportKind = "system.legacy-import";

    /// <summary>
    /// Bridge from the single-household config. Once (marked by a <see cref="LegacyImportKind"/>
    /// audit event, so a later unlink isn't undone by a reboot): <c>DIARY_PEOPLE</c>
    /// (<c>Name:email,…</c>, order = person id) names/links household 1's existing people and
    /// every <c>AUTH_ALLOWED_EMAILS</c> address without a person gets a new owner in household 1.
    /// Every boot: each <c>ADMIN_EMAILS</c> address without a person joins household 1 as an owner
    /// (so a fresh install's admin can sign in), and their person carries <c>IsAdmin</c>.
    /// Never guesses which emailless person an address belongs to.
    /// </summary>
    public static async Task ImportLegacyConfigAsync(MiseDbContext db, IConfiguration config, ILogger logger,
        CancellationToken ct = default)
    {
        var admins = (config["Auth:AdminEmails"] ?? "")
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(NormalizeEmail).OfType<string>().Distinct().ToList();
        if (!await db.AuditEvents.AnyAsync(e => e.Kind == LegacyImportKind, ct))
            await ImportOnceAsync(db, config, logger, ct);

        var people = await db.People.IgnoreQueryFilters().ToListAsync(ct);
        foreach (var email in admins)
        {
            var row = people.FirstOrDefault(x => x.Email == email);
            if (row is null)
            {
                var name = email.Split('@')[0];
                row = new Person { HouseholdId = 1, Name = name.Length > 60 ? name[..60] : name, Email = email, Role = HouseholdRole.Owner,
                    FirstStepsDismissedAt = DateTimeOffset.UtcNow }; // household 1 bootstrap = existing users
                db.People.Add(row);
                people.Add(row);
                logger.LogInformation("ADMIN_EMAILS: added {Email} to household 1", email);
            }
            row.IsAdmin = true;
        }
        await db.SaveChangesAsync(ct);
    }

    private static async Task ImportOnceAsync(MiseDbContext db, IConfiguration config, ILogger logger, CancellationToken ct)
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
        var allowed = (config["Auth:AllowedEmails"] ?? "")
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
                row = new Person { HouseholdId = 1, Name = entry.Name, Email = entry.Email, Role = HouseholdRole.Owner,
                    FirstStepsDismissedAt = DateTimeOffset.UtcNow }; // household 1 bootstrap = existing users
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
            var row = new Person { HouseholdId = 1, Name = name.Length > 60 ? name[..60] : name, Email = email, Role = HouseholdRole.Owner,
                    FirstStepsDismissedAt = DateTimeOffset.UtcNow }; // household 1 bootstrap = existing users
            db.People.Add(row);
            people.Add(row);
            logger.LogInformation("AUTH_ALLOWED_EMAILS: added {Email} to household 1 as a new person", email);
        }
        db.AuditEvents.Add(new AuditEvent
        {
            ActorName = "system",
            HouseholdId = 1,
            Kind = LegacyImportKind,
            Summary = $"Jednorazowy import DIARY_PEOPLE / AUTH_ALLOWED_EMAILS ({entries.Count + allowed.Count} wpisów).",
        });
        await db.SaveChangesAsync(ct);
    }
}
