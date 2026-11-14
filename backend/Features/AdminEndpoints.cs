using Microsoft.EntityFrameworkCore;
using Mise.Api.Data;
using Mise.Api.Domain;
using Mise.Api.Services;

namespace Mise.Api.Features;

public record AdminStatsDto(int Households, int People, int ActiveLast7Days, int PendingInvites, int LiveKeys, int BlockedPeople);
public record AdminOverviewDto(AdminStatsDto Stats, List<StarterSourceDto> Sources, int SourceRecipes, List<AuditEventDto> Recent);
public record AdminMemberDto(int Id, string Name, string Role, bool Blocked);
public record AdminHouseholdDto(int Id, string Name, bool SousEnabled, bool Blocked, DateTimeOffset CreatedAt,
    List<AdminMemberDto> Members, int Recipes, int PlanEntries, DateTimeOffset? LastSeenAt);
public record AdminHouseholdPatch(string? Name, bool? SousEnabled, bool? Blocked);
public record AdminPersonDto(int Id, string Name, string? Email, int HouseholdId, string HouseholdName, string Role,
    bool IsAdmin, bool EnvAdmin, bool Blocked, bool HouseholdBlocked, DateTimeOffset CreatedAt, DateTimeOffset? LastSeenAt, int Keys);
public record AdminPersonPatch(string? Name, string? Role, bool? IsAdmin, bool? Blocked);
public record AdminInviteDto(Guid Id, string Kind, string Status, DateTimeOffset CreatedAt, DateTimeOffset ExpiresAt,
    int? HouseholdId, string? HouseholdName, string Role, string Starter, List<string> StarterSources,
    string? CreatedBy, string? UsedBy, DateTimeOffset? UsedAt, DateTimeOffset? RevokedAt);
public record AdminInviteInput(string? Kind, int? HouseholdId, string? Role, string? HouseholdName, string? Starter, List<string>? Sources);
public record ExtendInput(int? Days);
public record AdminKeyDto(Guid Id, string Name, string Prefix, int PersonId, string PersonName, int HouseholdId, string HouseholdName,
    DateTimeOffset CreatedAt, DateTimeOffset? LastUsedAt, DateTimeOffset? RevokedAt);
public record AuditEventDto(Guid Id, DateTimeOffset At, string ActorName, string Kind, string Summary,
    int? HouseholdId, string? HouseholdName, int? TargetPersonId);

/// <summary>
/// The admin panel (<c>ADMIN_EMAILS</c> or <c>Person.IsAdmin</c>, Google session only). Admin views
/// span households, so their reads use <c>IgnoreQueryFilters()</c> on purpose — this file and the
/// identity lookups are the only places that do. Every mutation adds an <see cref="AuditEvent"/>.
/// Nothing is hard-deleted: people and households are blocked/unlinked, codes and keys revoked.
/// </summary>
public static class AdminEndpoints
{
    public static RouteGroupBuilder MapAdmin(this RouteGroupBuilder api)
    {
        var g = api.MapGroup("/admin").WithTags("Admin").AddEndpointFilter(async (ctx, next) =>
            ctx.HttpContext.RequestServices.GetRequiredService<Caller>() is { IsAdmin: true, IsPrivileged: true }
                ? await next(ctx)
                : Results.Json(new { error = "Tylko dla administratora." }, statusCode: StatusCodes.Status403Forbidden));

        g.MapGet("/overview", OverviewAsync);

        // ---- households ----
        g.MapGet("/households", async (MiseDbContext db, CancellationToken ct) => Results.Ok(await HouseholdsAsync(db, ct)));

        g.MapPatch("/households/{id:int}", async (int id, AdminHouseholdPatch input, Caller caller, MiseDbContext db,
            Audit audit, CancellationToken ct) =>
        {
            var household = await db.Households.FirstOrDefaultAsync(h => h.Id == id, ct);
            if (household is null) return Results.NotFound();
            if (input.Name is not null)
            {
                if (HouseholdEndpoints.CleanName(input.Name, 80) is not { } name)
                    return Results.BadRequest(new { error = "Nazwa domu: 1–80 znaków." });
                if (name != household.Name) audit.Add("household.renamed", $"Dom „{household.Name}” → „{name}”.", id);
                household.Name = name;
            }
            if (input.SousEnabled is bool sous && sous != household.SousEnabled)
            {
                household.SousEnabled = sous;
                audit.Add("household.sous", $"Sous {(sous ? "włączony" : "wyłączony")} dla „{household.Name}”.", id);
            }
            if (input.Blocked is bool blocked && blocked != (household.BlockedAt is not null))
            {
                if (blocked && id == caller.Self?.HouseholdId)
                    return Results.BadRequest(new { error = "Nie możesz zablokować własnego domu." });
                household.BlockedAt = blocked ? DateTimeOffset.UtcNow : null;
                audit.Add(blocked ? "household.blocked" : "household.unblocked",
                    $"Dom „{household.Name}” {(blocked ? "zablokowany" : "odblokowany")}.", id);
            }
            await db.SaveChangesAsync(ct);
            return Results.Ok((await HouseholdsAsync(db, ct)).First(h => h.Id == id));
        });

        // ---- people ----
        g.MapGet("/people", async (string? q, int? householdId, string? status, MiseDbContext db, AccessControl access,
            CancellationToken ct) => Results.Ok(await PeopleAsync(db, access, q, householdId, status, ct)));

        g.MapPatch("/people/{id:int}", async (int id, AdminPersonPatch input, Caller caller, MiseDbContext db,
            AccessControl access, Audit audit, CancellationToken ct) =>
        {
            var person = await db.People.IgnoreQueryFilters().FirstOrDefaultAsync(p => p.Id == id, ct);
            if (person is null) return Results.NotFound();
            var self = id == caller.Self?.Id;
            var envAdmin = access.IsAdminEmail(person.Email);

            if (input.Name is not null)
            {
                if (HouseholdEndpoints.CleanName(input.Name, 60) is not { } name) return Results.BadRequest(new { error = "Imię: 1–60 znaków." });
                person.Name = name;
            }
            if (input.Role is not null)
            {
                if (HouseholdEndpoints.ParseRole(input.Role) is not HouseholdRole role) return Results.BadRequest(new { error = "role: owner / member." });
                if (await HouseholdEndpoints.SetRoleAsync(db, audit, person, role, ct) is { } error) return Results.BadRequest(new { error });
            }
            // An ADMIN_EMAILS admin stays admin whatever the DB flag says — refuse instead of a silent no-op.
            if (input.IsAdmin == false && envAdmin)
                return Results.BadRequest(new { error = "Ta osoba jest administratorem z ADMIN_EMAILS — zmień to w .env." });
            if (input.IsAdmin is bool admin && admin != person.IsAdmin)
            {
                if (!admin && (self || envAdmin))
                    return Results.BadRequest(new { error = self
                        ? "Nie możesz odebrać uprawnień administratora sobie."
                        : "Ta osoba jest administratorem z ADMIN_EMAILS — zmień to w .env." });
                if (!admin && !await OtherAdminExistsAsync(db, access, person.Id, ct))
                    return Results.BadRequest(new { error = "Musi zostać co najmniej jeden administrator." });
                person.IsAdmin = admin;
                audit.Add(admin ? "admin.granted" : "admin.revoked",
                    $"{person.Name}: {(admin ? "nadano" : "odebrano")} uprawnienia administratora.", person.HouseholdId, person.Id);
            }
            if (input.Blocked is bool blocked && blocked != (person.BlockedAt is not null))
            {
                if (blocked && (self || envAdmin))
                    return Results.BadRequest(new { error = self ? "Nie możesz zablokować siebie." : "Administratora z ADMIN_EMAILS nie można zablokować." });
                if (blocked && person.IsAdmin && !await OtherAdminExistsAsync(db, access, person.Id, ct))
                    return Results.BadRequest(new { error = "Musi zostać co najmniej jeden administrator." });
                person.BlockedAt = blocked ? DateTimeOffset.UtcNow : null;
                audit.Add(blocked ? "person.blocked" : "person.unblocked",
                    $"{person.Name} ({person.Email ?? "bez konta"}) {(blocked ? "zablokowany(-a)" : "odblokowany(-a)")}.", person.HouseholdId, person.Id);
            }
            // A system scope may write anywhere — the admin edits people of other households.
            db.Tenant.UseSystem();
            await db.SaveChangesAsync(ct);
            return Results.Ok((await PeopleAsync(db, access, null, null, "all", ct)).First(p => p.Id == id));
        });

        // The Google account loses access (and may redeem a new code); the person and their data stay.
        g.MapPost("/people/{id:int}/unlink", async (int id, Caller caller, MiseDbContext db, AccessControl access,
            Audit audit, CancellationToken ct) =>
        {
            var person = await db.People.IgnoreQueryFilters().FirstOrDefaultAsync(p => p.Id == id, ct);
            if (person is null) return Results.NotFound();
            if (person.Email is null) return Results.BadRequest(new { error = "Ta osoba nie ma podłączonego konta." });
            if (id == caller.Self?.Id || access.IsAdminEmail(person.Email))
                return Results.BadRequest(new { error = "Tego konta nie można odłączyć." });
            audit.Add("person.unlinked", $"{person.Name}: odłączono konto {person.Email}.", person.HouseholdId, person.Id);
            person.Email = null;
            person.IsAdmin = false;
            await RevokeKeysAsync(db, person.Id, ct);
            db.Tenant.UseSystem();
            await db.SaveChangesAsync(ct);
            return Results.Ok((await PeopleAsync(db, access, null, null, "all", ct)).First(p => p.Id == id));
        });

        // ---- invite codes ----
        g.MapGet("/invites", async (string? status, MiseDbContext db, CancellationToken ct) =>
            Results.Ok(await InvitesAsync(db, status, ct)));

        g.MapPost("/invites", async (AdminInviteInput input, Caller caller, MiseDbContext db, Audit audit, CancellationToken ct) =>
        {
            var join = (input.Kind ?? "new-household").ToLowerInvariant() switch
            {
                "join" => true,
                "new-household" => false,
                _ => (bool?)null,
            };
            if (join is null) return Results.BadRequest(new { error = "kind: new-household / join." });

            if (join == true)
            {
                var household = await db.Households.FirstOrDefaultAsync(h => h.Id == input.HouseholdId, ct);
                if (household is null) return Results.BadRequest(new { error = "Wybierz dom, do którego ma dołączyć." });
                if (HouseholdEndpoints.ParseRole(input.Role ?? "member") is not HouseholdRole role)
                    return Results.BadRequest(new { error = "role: owner / member." });
                var (invite, code) = HouseholdEndpoints.NewInvite(InviteKind.Join, caller);
                invite.HouseholdId = household.Id;
                invite.Role = role;
                db.InviteCodes.Add(invite);
                audit.Add("invite.created", $"Kod dołączenia do „{household.Name}” ({HouseholdEndpoints.RoleLabel(role)}).", household.Id);
                await db.SaveChangesAsync(ct);
                return Results.Ok(new CreatedInviteDto(invite.Id, code, invite.ExpiresAt));
            }

            if (HouseholdEndpoints.ParseStarter(input.Starter) is not StarterMode starter)
                return Results.BadRequest(new { error = "starter: none / all / sources." });
            var sources = (input.Sources ?? []).Select(s => s.Trim()).Where(s => s.Length > 0).Distinct().ToList();
            if (starter == StarterMode.Sources && sources.Count == 0)
                return Results.BadRequest(new { error = "Wybierz co najmniej jedno źródło przepisów." });
            var name = input.HouseholdName is { Length: > 0 } ? HouseholdEndpoints.CleanName(input.HouseholdName, 80) : null;

            var (created, newCode) = HouseholdEndpoints.NewInvite(InviteKind.NewHousehold, caller);
            created.HouseholdName = name;
            created.Starter = starter;
            created.StarterSources = starter == StarterMode.Sources ? sources : [];
            created.SourceHouseholdId = caller.HouseholdId;
            created.Role = HouseholdRole.Owner;
            db.InviteCodes.Add(created);
            audit.Add("invite.created", $"Kod nowego domu{(name is null ? "" : $" „{name}”")}.", caller.HouseholdId);
            await db.SaveChangesAsync(ct);
            return Results.Ok(new CreatedInviteDto(created.Id, newCode, created.ExpiresAt));
        });

        g.MapPost("/invites/{id:guid}/extend", async (Guid id, ExtendInput input, MiseDbContext db, Audit audit, CancellationToken ct) =>
        {
            var days = Math.Clamp(input.Days ?? 7, 1, 30);
            var invite = await db.InviteCodes.FirstOrDefaultAsync(i => i.Id == id && i.UsedAt == null && i.RevokedAt == null, ct);
            if (invite is null) return Results.NotFound();
            var now = DateTimeOffset.UtcNow;
            invite.ExpiresAt = (invite.ExpiresAt > now ? invite.ExpiresAt : now).AddDays(days);
            audit.Add("invite.extended", $"Kod przedłużony o {days} dni.", invite.HouseholdId ?? invite.SourceHouseholdId);
            await db.SaveChangesAsync(ct);
            return Results.Ok((await InvitesAsync(db, "all", ct)).First(i => i.Id == id));
        });

        g.MapDelete("/invites/{id:guid}", async (Guid id, MiseDbContext db, Audit audit, CancellationToken ct) =>
        {
            var invite = await db.InviteCodes.FirstOrDefaultAsync(i => i.Id == id && i.UsedAt == null && i.RevokedAt == null, ct);
            if (invite is null) return Results.NotFound();
            invite.RevokedAt = DateTimeOffset.UtcNow;
            audit.Add("invite.revoked", "Anulowano kod zaproszenia.", invite.HouseholdId ?? invite.SourceHouseholdId);
            await db.SaveChangesAsync(ct);
            return Results.NoContent();
        });

        // ---- API keys ----
        g.MapGet("/keys", async (MiseDbContext db, CancellationToken ct) => Results.Ok(await KeysAsync(db, ct)));

        g.MapDelete("/keys/{id:guid}", async (Guid id, MiseDbContext db, Audit audit, CancellationToken ct) =>
        {
            var key = await db.ApiKeys.IgnoreQueryFilters().FirstOrDefaultAsync(k => k.Id == id && k.RevokedAt == null, ct);
            if (key is null) return Results.NotFound();
            key.RevokedAt = DateTimeOffset.UtcNow;
            audit.Add("key.revoked", $"Unieważniono klucz „{key.Name}” ({key.Prefix}…).", key.HouseholdId, key.PersonId);
            db.Tenant.UseSystem();
            await db.SaveChangesAsync(ct);
            return Results.NoContent();
        });

        // ---- audit log ----
        g.MapGet("/audit", async (DateTimeOffset? before, int? take, MiseDbContext db, CancellationToken ct) =>
            Results.Ok(await AuditAsync(db, before, Math.Clamp(take ?? 50, 1, 200), ct)));

        return api;
    }

    private static async Task<IResult> OverviewAsync(MiseDbContext db, AccessControl access, CancellationToken ct)
    {
        var now = DateTimeOffset.UtcNow;
        var weekAgo = now.AddDays(-7);
        var people = db.People.IgnoreQueryFilters();
        var stats = new AdminStatsDto(
            await db.Households.CountAsync(ct),
            await people.CountAsync(p => p.Email != null, ct),
            await people.CountAsync(p => p.LastSeenAt > weekAgo, ct),
            await db.InviteCodes.CountAsync(i => i.UsedAt == null && i.RevokedAt == null && i.ExpiresAt > now, ct),
            await db.ApiKeys.IgnoreQueryFilters().CountAsync(k => k.RevokedAt == null, ct),
            await people.CountAsync(p => p.BlockedAt != null, ct));
        // Starter sources come from the admin's own household (the tenant): that's what a new household copies.
        var sources = await HouseholdProvisioner.SourcesAsync(db, ct);
        return Results.Ok(new AdminOverviewDto(stats, sources.Select(s => new StarterSourceDto(s.Name, s.Count)).ToList(),
            await db.Recipes.CountAsync(ct), await AuditAsync(db, null, 10, ct)));
    }

    private static async Task<List<AdminHouseholdDto>> HouseholdsAsync(MiseDbContext db, CancellationToken ct)
    {
        var people = await db.People.IgnoreQueryFilters().AsNoTracking()
            .Select(p => new { p.Id, p.HouseholdId, p.Name, p.Role, p.BlockedAt, p.LastSeenAt, p.Email }).ToListAsync(ct);
        var recipes = await db.Recipes.IgnoreQueryFilters().GroupBy(r => r.HouseholdId)
            .Select(g => new { g.Key, Count = g.Count() }).ToDictionaryAsync(x => x.Key, x => x.Count, ct);
        var entries = await db.PlanEntries.IgnoreQueryFilters().GroupBy(e => e.HouseholdId)
            .Select(g => new { g.Key, Count = g.Count() }).ToDictionaryAsync(x => x.Key, x => x.Count, ct);
        return (await db.Households.AsNoTracking().OrderBy(h => h.Id).ToListAsync(ct)).Select(h =>
        {
            var members = people.Where(p => p.HouseholdId == h.Id).OrderBy(p => p.Id).ToList();
            return new AdminHouseholdDto(h.Id, h.Name, h.SousEnabled, h.BlockedAt is not null, h.CreatedAt,
                members.Select(p => new AdminMemberDto(p.Id, p.Name, HouseholdEndpoints.RoleToken(p.Role), p.BlockedAt is not null)).ToList(),
                recipes.GetValueOrDefault(h.Id), entries.GetValueOrDefault(h.Id),
                members.Max(p => p.LastSeenAt));
        }).ToList();
    }

    private static async Task<List<AdminPersonDto>> PeopleAsync(MiseDbContext db, AccessControl access, string? q,
        int? householdId, string? status, CancellationToken ct)
    {
        var households = await db.Households.AsNoTracking().ToDictionaryAsync(h => h.Id, ct);
        var keys = await db.ApiKeys.IgnoreQueryFilters().Where(k => k.RevokedAt == null)
            .GroupBy(k => k.PersonId).Select(g => new { g.Key, Count = g.Count() }).ToDictionaryAsync(x => x.Key, x => x.Count, ct);
        var query = db.People.IgnoreQueryFilters().AsNoTracking();
        if (householdId is int h) query = query.Where(p => p.HouseholdId == h);
        var list = (await query.OrderBy(p => p.HouseholdId).ThenBy(p => p.Id).ToListAsync(ct))
            .Select(p => new AdminPersonDto(p.Id, p.Name, p.Email, p.HouseholdId, households[p.HouseholdId].Name,
                HouseholdEndpoints.RoleToken(p.Role), p.IsAdmin || access.IsAdminEmail(p.Email), access.IsAdminEmail(p.Email),
                p.BlockedAt is not null, households[p.HouseholdId].BlockedAt is not null, p.CreatedAt, p.LastSeenAt,
                keys.GetValueOrDefault(p.Id)));
        if (!string.IsNullOrWhiteSpace(q))
        {
            var needle = q.Trim();
            list = list.Where(p => p.Name.Contains(needle, StringComparison.OrdinalIgnoreCase)
                || (p.Email?.Contains(needle, StringComparison.OrdinalIgnoreCase) ?? false)
                || p.HouseholdName.Contains(needle, StringComparison.OrdinalIgnoreCase));
        }
        list = (status ?? "all").ToLowerInvariant() switch
        {
            "blocked" => list.Where(p => p.Blocked || p.HouseholdBlocked),
            "admins" => list.Where(p => p.IsAdmin),
            "unlinked" => list.Where(p => p.Email is null),
            "active" => list.Where(p => !p.Blocked && !p.HouseholdBlocked && p.Email is not null),
            _ => list,
        };
        return list.ToList();
    }

    private static async Task<List<AdminInviteDto>> InvitesAsync(MiseDbContext db, string? status, CancellationToken ct)
    {
        var now = DateTimeOffset.UtcNow;
        var names = await db.People.IgnoreQueryFilters().AsNoTracking().ToDictionaryAsync(p => p.Id, p => p.Name, ct);
        var households = await db.Households.AsNoTracking().ToDictionaryAsync(h => h.Id, h => h.Name, ct);
        string StatusOf(InviteCode i) => i.UsedAt is not null ? "used" : i.RevokedAt is not null ? "revoked"
            : i.ExpiresAt <= now ? "expired" : "pending";
        var wanted = (status ?? "pending").ToLowerInvariant();
        return (await db.InviteCodes.AsNoTracking().OrderByDescending(i => i.CreatedAt).ToListAsync(ct))
            .Select(i =>
            {
                var household = i.HouseholdId ?? i.CreatedHouseholdId;
                return new AdminInviteDto(i.Id, i.Kind == InviteKind.Join ? "join" : "new-household", StatusOf(i),
                    i.CreatedAt, i.ExpiresAt, household,
                    household is int hid ? households.GetValueOrDefault(hid) : i.HouseholdName,
                    HouseholdEndpoints.RoleToken(i.Role), i.Starter.ToString().ToLowerInvariant(), i.StarterSources,
                    i.CreatedByPersonId is int c ? names.GetValueOrDefault(c) : null,
                    i.UsedByPersonId is int u ? names.GetValueOrDefault(u) : null, i.UsedAt, i.RevokedAt);
            })
            .Where(i => wanted == "all" || i.Status == wanted)
            .ToList();
    }

    private static async Task<List<AdminKeyDto>> KeysAsync(MiseDbContext db, CancellationToken ct)
    {
        var people = await db.People.IgnoreQueryFilters().AsNoTracking().ToDictionaryAsync(p => p.Id, p => p.Name, ct);
        var households = await db.Households.AsNoTracking().ToDictionaryAsync(h => h.Id, h => h.Name, ct);
        return (await db.ApiKeys.IgnoreQueryFilters().AsNoTracking()
                .OrderBy(k => k.RevokedAt != null).ThenByDescending(k => k.CreatedAt).ToListAsync(ct))
            .Select(k => new AdminKeyDto(k.Id, k.Name, k.Prefix, k.PersonId, people.GetValueOrDefault(k.PersonId) ?? "?",
                k.HouseholdId, households.GetValueOrDefault(k.HouseholdId) ?? "?", k.CreatedAt, k.LastUsedAt, k.RevokedAt))
            .ToList();
    }

    private static async Task<List<AuditEventDto>> AuditAsync(MiseDbContext db, DateTimeOffset? before, int take, CancellationToken ct)
    {
        var households = await db.Households.AsNoTracking().ToDictionaryAsync(h => h.Id, h => h.Name, ct);
        var query = db.AuditEvents.AsNoTracking().AsQueryable();
        if (before is DateTimeOffset b) query = query.Where(e => e.At < b);
        return (await query.OrderByDescending(e => e.At).Take(take).ToListAsync(ct))
            .Select(e => new AuditEventDto(e.Id, e.At, e.ActorName, e.Kind, e.Summary, e.HouseholdId,
                e.HouseholdId is int h ? households.GetValueOrDefault(h) : null, e.TargetPersonId))
            .ToList();
    }

    private static async Task<bool> OtherAdminExistsAsync(MiseDbContext db, AccessControl access, int except, CancellationToken ct)
    {
        var others = await db.People.IgnoreQueryFilters().AsNoTracking()
            .Where(p => p.Id != except && p.BlockedAt == null && p.Email != null)
            .Select(p => new { p.IsAdmin, p.Email }).ToListAsync(ct);
        return others.Any(p => p.IsAdmin || access.IsAdminEmail(p.Email));
    }

    private static async Task RevokeKeysAsync(MiseDbContext db, int personId, CancellationToken ct)
    {
        var now = DateTimeOffset.UtcNow;
        foreach (var key in await db.ApiKeys.IgnoreQueryFilters().Where(k => k.PersonId == personId && k.RevokedAt == null).ToListAsync(ct))
            key.RevokedAt = now;
    }
}
