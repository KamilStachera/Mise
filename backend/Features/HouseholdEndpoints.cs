using System.Security.Claims;
using System.Threading.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Mise.Api.Data;
using Mise.Api.Domain;
using Mise.Api.Services;

namespace Mise.Api.Features;

public record HouseholdMemberDto(int Id, string Name, string? Email, bool IsSelf, string Role);
public record InviteDto(Guid Id, string Kind, DateTimeOffset CreatedAt, DateTimeOffset ExpiresAt, string? HouseholdName,
    string Starter, List<string> StarterSources, string Role);
public record HouseholdDetailDto(int Id, string Name, bool SousEnabled, bool CanManage,
    List<HouseholdMemberDto> Members, List<InviteDto> Invites);
public record CreatedInviteDto(Guid Id, string Code, DateTimeOffset ExpiresAt);
public record HouseholdRenameInput(string? Name);
public record PersonRenameInput(string? Name);
public record RoleInput(string? Role);
public record StarterSourceDto(string Name, int Count);
public record RedeemInput(string? Code, string? Name);

/// <summary>
/// Households and how people get into one. <c>/household</c> = the caller's own (members, roles,
/// join codes — managing it takes the owner role); <c>/onboarding/redeem</c> = a signed-in Google
/// account with no household redeems a code. The admin panel lives in <see cref="AdminEndpoints"/>.
/// </summary>
public static class HouseholdEndpoints
{
    public const string RedeemRateLimit = "redeem";

    /// <summary>Invite codes are ~50 bits, but don't let anyone hammer the redeem endpoint anyway: 5 tries per 10 min per account (or IP).</summary>
    public static IServiceCollection AddHouseholdRateLimits(this IServiceCollection services) =>
        services.AddRateLimiter(o =>
        {
            o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
            o.AddPolicy(RedeemRateLimit, ctx => RateLimitPartition.GetFixedWindowLimiter(
                ctx.User.FindFirstValue(ClaimTypes.Email) ?? ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown",
                _ => new FixedWindowRateLimiterOptions { PermitLimit = 5, Window = TimeSpan.FromMinutes(10), QueueLimit = 0 }));
        });

    private static readonly IResult OwnersOnly =
        Results.Json(new { error = "Tylko właściciel domu może to zmienić." }, statusCode: StatusCodes.Status403Forbidden);

    public static RouteGroupBuilder MapHouseholds(this RouteGroupBuilder api)
    {
        var g = api.MapGroup("/household").WithTags("Household");

        g.MapGet("/", async (Caller caller, MiseDbContext db, CancellationToken ct) =>
            Results.Ok(await DetailAsync(db, caller, ct)));

        g.MapPatch("/", async (HouseholdRenameInput input, Caller caller, MiseDbContext db, Audit audit, CancellationToken ct) =>
        {
            if (!caller.IsOwner) return OwnersOnly;
            if (CleanName(input.Name, 80) is not { } name) return Results.BadRequest(new { error = "Nazwa domu: 1–80 znaków." });
            var household = await db.Households.FirstAsync(h => h.Id == caller.HouseholdId, ct);
            audit.Add("household.renamed", $"Dom „{household.Name}” → „{name}”.", household.Id);
            household.Name = name;
            await db.SaveChangesAsync(ct);
            return Results.Ok(await DetailAsync(db, caller, ct));
        });

        // Everyone may rename themselves; renaming others takes the owner role.
        g.MapPatch("/people/{id:int}", async (int id, PersonRenameInput input, Caller caller, MiseDbContext db, CancellationToken ct) =>
        {
            if (id != caller.Self?.Id && !caller.IsOwner) return OwnersOnly;
            if (CleanName(input.Name, 60) is not { } name) return Results.BadRequest(new { error = "Imię: 1–60 znaków." });
            var person = await db.People.FirstOrDefaultAsync(p => p.Id == id, ct);
            if (person is null) return Results.NotFound();
            person.Name = name;
            await db.SaveChangesAsync(ct);
            return Results.Ok(await DetailAsync(db, caller, ct));
        });

        g.MapPatch("/people/{id:int}/role", async (int id, RoleInput input, Caller caller, MiseDbContext db, Audit audit, CancellationToken ct) =>
        {
            if (!caller.IsOwner) return OwnersOnly;
            if (ParseRole(input.Role) is not HouseholdRole role) return Results.BadRequest(new { error = "role: owner / member." });
            var person = await db.People.FirstOrDefaultAsync(p => p.Id == id, ct);
            if (person is null) return Results.NotFound();
            if (await SetRoleAsync(db, audit, person, role, ct) is { } error) return Results.BadRequest(new { error });
            await db.SaveChangesAsync(ct);
            return Results.Ok(await DetailAsync(db, caller, ct));
        });

        g.MapPost("/invites", async (Caller caller, MiseDbContext db, Audit audit, CancellationToken ct) =>
        {
            if (!caller.IsOwner) return OwnersOnly;
            var (invite, code) = NewInvite(InviteKind.Join, caller);
            invite.HouseholdId = caller.HouseholdId;
            db.InviteCodes.Add(invite);
            audit.Add("invite.created", "Kod dołączenia do domu.", caller.HouseholdId);
            await db.SaveChangesAsync(ct);
            return Results.Ok(new CreatedInviteDto(invite.Id, code, invite.ExpiresAt));
        });

        g.MapDelete("/invites/{id:guid}", async (Guid id, Caller caller, MiseDbContext db, Audit audit, CancellationToken ct) =>
        {
            if (!caller.IsOwner) return OwnersOnly;
            var invite = await db.InviteCodes.FirstOrDefaultAsync(
                i => i.Id == id && i.Kind == InviteKind.Join && i.HouseholdId == caller.HouseholdId && i.UsedAt == null && i.RevokedAt == null, ct);
            if (invite is null) return Results.NotFound();
            invite.RevokedAt = DateTimeOffset.UtcNow;
            audit.Add("invite.revoked", "Anulowano kod dołączenia.", caller.HouseholdId);
            await db.SaveChangesAsync(ct);
            return Results.NoContent();
        });

        api.MapPost("/onboarding/redeem", RedeemAsync).WithTags("Household").RequireRateLimiting(RedeemRateLimit);
        return api;
    }

    /// <summary>
    /// The only way into a household. Join → a new person in that household (with the code's role);
    /// NewHousehold → a new household (seed + starter copy) with the redeemer as its owner. One transaction.
    /// </summary>
    private static async Task<IResult> RedeemAsync(RedeemInput input, Caller caller, MiseDbContext db, Audit audit,
        HouseholdProvisioner provisioner, ContextExportService export, ILogger<HouseholdProvisioner> logger, CancellationToken ct)
    {
        if (caller.Kind != CallerKind.Unlinked || caller.Email is null)
            return Results.BadRequest(new { error = caller.Kind == CallerKind.Anonymous
                ? "Najpierw zaloguj się przez Google."
                : "To konto już należy do domu." });
        if (CleanName(input.Name, 60) is not { } name) return Results.BadRequest(new { error = "Podaj imię (1–60 znaków)." });
        var normalized = Invites.Normalize(input.Code);
        var hash = normalized is null ? null : Invites.Hash(normalized);
        var now = DateTimeOffset.UtcNow;
        var invite = hash is null ? null : await db.InviteCodes.FirstOrDefaultAsync(i => i.CodeHash == hash, ct);
        if (invite is null || invite.UsedAt is not null || invite.RevokedAt is not null || invite.ExpiresAt <= now)
            return Results.BadRequest(new { error = "Nieprawidłowy, wykorzystany lub wygasły kod." });
        if (invite.Kind == InviteKind.Join
            && await db.Households.AnyAsync(h => h.Id == invite.HouseholdId && h.BlockedAt != null, ct))
            return Results.BadRequest(new { error = "Ten dom jest zablokowany." });

        await using var tx = db.Database.IsRelational() ? await db.Database.BeginTransactionAsync(ct) : null;
        int householdId;
        if (invite.Kind == InviteKind.Join)
        {
            householdId = invite.HouseholdId!.Value;
            db.Tenant.UseHousehold(householdId);
        }
        else
        {
            var household = await provisioner.CreateAsync(invite.HouseholdName ?? $"Dom — {name}", invite.Starter,
                invite.StarterSources, invite.SourceHouseholdId, ct);
            householdId = household.Id;
            audit.Add("household.created", $"Nowy dom „{household.Name}” ({caller.Email}).", householdId);
        }

        var person = new Person
        {
            HouseholdId = householdId,
            Name = name,
            Email = caller.Email,
            Role = invite.Kind == InviteKind.NewHousehold ? HouseholdRole.Owner : invite.Role,
        };
        db.People.Add(person);
        await db.SaveChangesAsync(ct);

        db.InviteCodes.Attach(invite);
        invite.UsedAt = now;
        invite.UsedByPersonId = person.Id;
        if (invite.Kind == InviteKind.NewHousehold) invite.CreatedHouseholdId = householdId;
        audit.Add("invite.redeemed", $"{name} ({caller.Email}) dołącza jako {RoleLabel(person.Role)}.", householdId, person.Id);
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateConcurrencyException)
        {
            return Results.BadRequest(new { error = "Ten kod został właśnie wykorzystany." });   // tx rolls back on dispose
        }
        if (tx is not null) await tx.CommitAsync(ct);
        logger.LogInformation("{Email} joined household {Household} with a {Kind} code", caller.Email, householdId, invite.Kind);

        try { await export.ExportAsync(ct); }
        catch (Exception ex) { logger.LogWarning("Context export after onboarding failed: {Message}", ex.Message); }
        return Results.Ok(new { householdId, personId = person.Id });
    }

    // ---- shared with AdminEndpoints ----

    internal static (InviteCode Invite, string Code) NewInvite(InviteKind kind, Caller caller)
    {
        var code = Invites.NewCode();
        return (new InviteCode
        {
            Kind = kind,
            CodeHash = Invites.Hash(Invites.Normalize(code)!),
            CreatedByPersonId = caller.Self?.Id,
            ExpiresAt = DateTimeOffset.UtcNow + Invites.Lifetime,
        }, code);
    }

    /// <summary>Changes a role; refuses to leave a household without an owner. Caller saves.</summary>
    internal static async Task<string?> SetRoleAsync(MiseDbContext db, Audit audit, Person person, HouseholdRole role, CancellationToken ct)
    {
        if (person.Role == role) return null;
        if (role == HouseholdRole.Member && !await db.People.IgnoreQueryFilters().AnyAsync(p =>
                p.HouseholdId == person.HouseholdId && p.Id != person.Id && p.Role == HouseholdRole.Owner && p.BlockedAt == null, ct))
            return "Dom musi mieć co najmniej jednego właściciela.";
        person.Role = role;
        audit.Add("role.changed", $"{person.Name}: {RoleLabel(role)}.", person.HouseholdId, person.Id);
        return null;
    }

    internal static HouseholdRole? ParseRole(string? role) => role?.ToLowerInvariant() switch
    {
        "owner" => HouseholdRole.Owner,
        "member" => HouseholdRole.Member,
        _ => null,
    };

    internal static string RoleToken(HouseholdRole role) => role == HouseholdRole.Owner ? "owner" : "member";

    internal static string RoleLabel(HouseholdRole role) => role == HouseholdRole.Owner ? "właściciel" : "domownik";

    internal static StarterMode? ParseStarter(string? starter) => (starter ?? "none").ToLowerInvariant() switch
    {
        "none" => StarterMode.None,
        "all" => StarterMode.All,
        "sources" => StarterMode.Sources,
        _ => null,
    };

    internal static InviteDto ToDto(InviteCode i) => new(i.Id, i.Kind == InviteKind.Join ? "join" : "new-household",
        i.CreatedAt, i.ExpiresAt, i.HouseholdName, i.Starter.ToString().ToLowerInvariant(), i.StarterSources, RoleToken(i.Role));

    internal static string? CleanName(string? name, int max)
    {
        var trimmed = name?.Trim();
        return string.IsNullOrEmpty(trimmed) || trimmed.Length > max ? null : trimmed;
    }

    private static async Task<HouseholdDetailDto> DetailAsync(MiseDbContext db, Caller caller, CancellationToken ct)
    {
        var household = await db.Households.AsNoTracking().FirstAsync(h => h.Id == caller.HouseholdId, ct);
        var self = caller.Self!.Id;
        var members = (await db.People.AsNoTracking().OrderBy(p => p.Id).ToListAsync(ct))
            .Select(p => new HouseholdMemberDto(p.Id, p.Name, p.Email, p.Id == self, RoleToken(p.Role))).ToList();
        var now = DateTimeOffset.UtcNow;
        var invites = caller.IsOwner
            ? await db.InviteCodes.AsNoTracking()
                .Where(i => i.Kind == InviteKind.Join && i.HouseholdId == caller.HouseholdId
                    && i.UsedAt == null && i.RevokedAt == null && i.ExpiresAt > now)
                .OrderBy(i => i.CreatedAt).ToListAsync(ct)
            : [];
        return new HouseholdDetailDto(household.Id, household.Name, household.SousEnabled, caller.IsOwner,
            members, invites.Select(ToDto).ToList());
    }
}
