using System.Security.Claims;
using System.Threading.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Mise.Api.Data;
using Mise.Api.Domain;
using Mise.Api.Services;

namespace Mise.Api.Features;

public record HouseholdMemberDto(int Id, string Name, string? Email, bool IsSelf);
public record InviteDto(Guid Id, string Kind, DateTimeOffset CreatedAt, DateTimeOffset ExpiresAt, string? HouseholdName,
    string Starter, List<string> StarterSources);
public record HouseholdDetailDto(int Id, string Name, bool SousEnabled, List<HouseholdMemberDto> Members, List<InviteDto> Invites);
public record CreatedInviteDto(Guid Id, string Code, DateTimeOffset ExpiresAt);
public record HouseholdRenameInput(string? Name);
public record PersonRenameInput(string? Name);
public record AdminHouseholdDto(int Id, string Name, bool SousEnabled, DateTimeOffset CreatedAt, List<string> Members, int Recipes);
public record AdminOverviewDto(List<AdminHouseholdDto> Households, List<InviteDto> Invites, List<StarterSourceDto> Sources, int SourceRecipes);
public record StarterSourceDto(string Name, int Count);
public record AdminInviteInput(string? HouseholdName, string? Starter, List<string>? Sources);
public record AdminHouseholdPatch(string? Name, bool? SousEnabled);
public record RedeemInput(string? Code, string? Name);

/// <summary>
/// Households and how people get into one. <c>/household</c> = the caller's own (members, join
/// codes); <c>/admin</c> = <c>ADMIN_EMAILS</c> only (new-household codes, Sous per household);
/// <c>/onboarding/redeem</c> = a signed-in Google account with no household redeems a code.
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

    public static RouteGroupBuilder MapHouseholds(this RouteGroupBuilder api)
    {
        var g = api.MapGroup("/household").WithTags("Household");

        g.MapGet("/", async (Caller caller, MiseDbContext db, CancellationToken ct) =>
            Results.Ok(await DetailAsync(db, caller, ct)));

        g.MapPatch("/", async (HouseholdRenameInput input, Caller caller, MiseDbContext db, CancellationToken ct) =>
        {
            if (CleanName(input.Name, 80) is not { } name) return Results.BadRequest(new { error = "Nazwa domu: 1–80 znaków." });
            var household = await db.Households.FirstAsync(h => h.Id == caller.HouseholdId, ct);
            household.Name = name;
            await db.SaveChangesAsync(ct);
            return Results.Ok(await DetailAsync(db, caller, ct));
        });

        // Partners may fix each other's display names; the filter keeps it inside the household.
        g.MapPatch("/people/{id:int}", async (int id, PersonRenameInput input, Caller caller, MiseDbContext db, CancellationToken ct) =>
        {
            if (CleanName(input.Name, 60) is not { } name) return Results.BadRequest(new { error = "Imię: 1–60 znaków." });
            var person = await db.People.FirstOrDefaultAsync(p => p.Id == id, ct);
            if (person is null) return Results.NotFound();
            person.Name = name;
            await db.SaveChangesAsync(ct);
            return Results.Ok(await DetailAsync(db, caller, ct));
        });

        g.MapPost("/invites", async (Caller caller, MiseDbContext db, CancellationToken ct) =>
        {
            var (invite, code) = NewInvite(InviteKind.Join, caller);
            invite.HouseholdId = caller.HouseholdId;
            db.InviteCodes.Add(invite);
            await db.SaveChangesAsync(ct);
            return Results.Ok(new CreatedInviteDto(invite.Id, code, invite.ExpiresAt));
        });

        g.MapDelete("/invites/{id:guid}", async (Guid id, Caller caller, MiseDbContext db, CancellationToken ct) =>
        {
            var invite = await db.InviteCodes.FirstOrDefaultAsync(
                i => i.Id == id && i.Kind == InviteKind.Join && i.HouseholdId == caller.HouseholdId && i.UsedAt == null, ct);
            if (invite is null) return Results.NotFound();
            db.InviteCodes.Remove(invite);
            await db.SaveChangesAsync(ct);
            return Results.NoContent();
        });

        MapAdmin(api.MapGroup("/admin").WithTags("Admin").AddEndpointFilter(async (ctx, next) =>
            ctx.HttpContext.RequestServices.GetRequiredService<Caller>() is { IsAdmin: true, IsPrivileged: true }
                ? await next(ctx)
                : Results.Json(new { error = "Tylko dla administratora." }, statusCode: StatusCodes.Status403Forbidden)));

        api.MapPost("/onboarding/redeem", RedeemAsync).WithTags("Household").RequireRateLimiting(RedeemRateLimit);
        return api;
    }

    private static void MapAdmin(RouteGroupBuilder g)
    {
        g.MapGet("/", async (MiseDbContext db, CancellationToken ct) => Results.Ok(await AdminOverviewAsync(db, ct)));

        g.MapPost("/invites", async (AdminInviteInput input, Caller caller, MiseDbContext db, CancellationToken ct) =>
        {
            var starter = (input.Starter ?? "none").ToLowerInvariant() switch
            {
                "none" => StarterMode.None,
                "all" => StarterMode.All,
                "sources" => StarterMode.Sources,
                _ => (StarterMode?)null,
            };
            if (starter is null) return Results.BadRequest(new { error = "starter: none / all / sources." });
            var sources = (input.Sources ?? []).Select(s => s.Trim()).Where(s => s.Length > 0).Distinct().ToList();
            if (starter == StarterMode.Sources && sources.Count == 0)
                return Results.BadRequest(new { error = "Wybierz co najmniej jedno źródło przepisów." });
            var name = input.HouseholdName is { Length: > 0 } ? CleanName(input.HouseholdName, 80) : null;

            var (invite, code) = NewInvite(InviteKind.NewHousehold, caller);
            invite.HouseholdName = name;
            invite.Starter = starter.Value;
            invite.StarterSources = starter == StarterMode.Sources ? sources : [];
            invite.SourceHouseholdId = caller.HouseholdId;
            db.InviteCodes.Add(invite);
            await db.SaveChangesAsync(ct);
            return Results.Ok(new CreatedInviteDto(invite.Id, code, invite.ExpiresAt));
        });

        g.MapDelete("/invites/{id:guid}", async (Guid id, MiseDbContext db, CancellationToken ct) =>
        {
            var invite = await db.InviteCodes.FirstOrDefaultAsync(i => i.Id == id && i.UsedAt == null, ct);
            if (invite is null) return Results.NotFound();
            db.InviteCodes.Remove(invite);
            await db.SaveChangesAsync(ct);
            return Results.NoContent();
        });

        g.MapPatch("/households/{id:int}", async (int id, AdminHouseholdPatch input, MiseDbContext db, CancellationToken ct) =>
        {
            var household = await db.Households.FirstOrDefaultAsync(h => h.Id == id, ct);
            if (household is null) return Results.NotFound();
            if (input.Name is not null)
            {
                if (CleanName(input.Name, 80) is not { } name) return Results.BadRequest(new { error = "Nazwa domu: 1–80 znaków." });
                household.Name = name;
            }
            if (input.SousEnabled is bool sous) household.SousEnabled = sous;
            await db.SaveChangesAsync(ct);
            return Results.Ok(await AdminOverviewAsync(db, ct));
        });
    }

    /// <summary>
    /// The only way into a household. Join → a new person in that household; NewHousehold → a new
    /// household (seed + starter copy) with the redeemer as its first person. All in one transaction.
    /// </summary>
    private static async Task<IResult> RedeemAsync(RedeemInput input, Caller caller, MiseDbContext db,
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
        if (invite is null || invite.UsedAt is not null || invite.ExpiresAt <= now)
            return Results.BadRequest(new { error = "Nieprawidłowy, wykorzystany lub wygasły kod." });

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
        }

        var person = new Person { HouseholdId = householdId, Name = name, Email = caller.Email };
        db.People.Add(person);
        await db.SaveChangesAsync(ct);

        db.InviteCodes.Attach(invite);
        invite.UsedAt = now;
        invite.UsedByPersonId = person.Id;
        if (invite.Kind == InviteKind.NewHousehold) invite.CreatedHouseholdId = householdId;
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

    private static (InviteCode Invite, string Code) NewInvite(InviteKind kind, Caller caller)
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

    private static async Task<HouseholdDetailDto> DetailAsync(MiseDbContext db, Caller caller, CancellationToken ct)
    {
        var household = await db.Households.AsNoTracking().FirstAsync(h => h.Id == caller.HouseholdId, ct);
        var members = await db.People.AsNoTracking().OrderBy(p => p.Id)
            .Select(p => new HouseholdMemberDto(p.Id, p.Name, p.Email, p.Id == caller.Self!.Id)).ToListAsync(ct);
        var now = DateTimeOffset.UtcNow;
        var invites = await db.InviteCodes.AsNoTracking()
            .Where(i => i.Kind == InviteKind.Join && i.HouseholdId == caller.HouseholdId && i.UsedAt == null && i.ExpiresAt > now)
            .OrderBy(i => i.CreatedAt).ToListAsync(ct);
        return new HouseholdDetailDto(household.Id, household.Name, household.SousEnabled, members, invites.Select(ToDto).ToList());
    }

    private static async Task<AdminOverviewDto> AdminOverviewAsync(MiseDbContext db, CancellationToken ct)
    {
        // Counts across households: the admin's own tenant only covers their household.
        var people = await db.People.IgnoreQueryFilters().AsNoTracking()
            .Select(p => new { p.HouseholdId, p.Name }).ToListAsync(ct);
        var recipes = await db.Recipes.IgnoreQueryFilters().AsNoTracking()
            .GroupBy(r => r.HouseholdId).Select(g => new { g.Key, Count = g.Count() }).ToListAsync(ct);
        var households = (await db.Households.AsNoTracking().OrderBy(h => h.Id).ToListAsync(ct))
            .Select(h => new AdminHouseholdDto(h.Id, h.Name, h.SousEnabled, h.CreatedAt,
                people.Where(p => p.HouseholdId == h.Id).Select(p => p.Name).ToList(),
                recipes.FirstOrDefault(r => r.Key == h.Id)?.Count ?? 0))
            .ToList();
        var now = DateTimeOffset.UtcNow;
        var invites = await db.InviteCodes.AsNoTracking()
            .Where(i => i.Kind == InviteKind.NewHousehold && i.UsedAt == null && i.ExpiresAt > now)
            .OrderBy(i => i.CreatedAt).ToListAsync(ct);
        var sources = await HouseholdProvisioner.SourcesAsync(db, ct);
        return new AdminOverviewDto(households, invites.Select(ToDto).ToList(),
            sources.Select(s => new StarterSourceDto(s.Name, s.Count)).ToList(), await db.Recipes.CountAsync(ct));
    }

    private static InviteDto ToDto(InviteCode i) => new(i.Id, i.Kind == InviteKind.Join ? "join" : "new-household",
        i.CreatedAt, i.ExpiresAt, i.HouseholdName, i.Starter.ToString().ToLowerInvariant(), i.StarterSources);

    private static string? CleanName(string? name, int max)
    {
        var trimmed = name?.Trim();
        return string.IsNullOrEmpty(trimmed) || trimmed.Length > max ? null : trimmed;
    }
}
