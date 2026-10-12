using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Mise.Api.Data;
using Mise.Api.Domain;

namespace Mise.Api.Services;

/// <summary>The person a request acts for — whose diary, goal, weight and band it touches.</summary>
public sealed record PersonScope(int Id)
{
    public static readonly PersonScope Default = new(Person.DefaultId);
}

public sealed record PersonInfo(int Id, string Name, string? Email);

/// <summary>
/// Who keeps a diary, from config <c>Diary:People</c> (env <c>DIARY_PEOPLE</c>):
/// <c>Name:email,Name:email</c>. Order gives the Id, so person 1 (the first entry) keeps
/// everything logged before people existed. Unset = one person, and the app looks single-user.
/// </summary>
public sealed class People
{
    /// <summary>The switcher sends this; honoured for privileged callers only.</summary>
    public const string Header = "X-Person";

    public IReadOnlyList<PersonInfo> All { get; }

    public People(IConfiguration config)
    {
        var list = (config["Diary:People"] ?? "")
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select((part, i) =>
            {
                var colon = part.IndexOf(':');
                var name = (colon < 0 ? part : part[..colon]).Trim();
                var email = colon < 0 ? null : part[(colon + 1)..].Trim();
                return new PersonInfo(i + 1, name.Length > 0 ? name : $"Osoba {i + 1}",
                    string.IsNullOrEmpty(email) ? null : email);
            })
            .ToList();
        All = list.Count > 0 ? list : [new PersonInfo(Person.DefaultId, "Ja", null)];
    }

    public bool Exists(int id) => All.Any(p => p.Id == id);

    public PersonInfo? ByEmail(string? email) =>
        email is null ? null : All.FirstOrDefault(p => string.Equals(p.Email, email, StringComparison.OrdinalIgnoreCase));

    /// <summary>The caller's own person: their Google email, else person 1 (API key, dev bypass, anonymous).</summary>
    public int Own(HttpContext ctx) =>
        ctx.User.Identity?.IsAuthenticated == true && ByEmail(ctx.User.FindFirstValue(ClaimTypes.Email)) is { } p
            ? p.Id
            : Person.DefaultId;

    /// <summary>
    /// The person a request acts for: the <see cref="Header"/> pick (privileged callers only —
    /// the two of them may look at each other's diary), else <see cref="Own"/>.
    /// </summary>
    public PersonScope Resolve(HttpContext? ctx, AccessControl access)
    {
        if (ctx is null) return PersonScope.Default;
        if (int.TryParse(ctx.Request.Headers[Header], out var picked) && Exists(picked) && access.IsPrivileged(ctx))
            return new PersonScope(picked);
        return new PersonScope(Own(ctx));
    }

    /// <summary>Mirrors the config into the People table (FK target). Rows are never deleted.</summary>
    public async Task SyncAsync(MiseDbContext db, CancellationToken ct = default)
    {
        var rows = await db.People.ToDictionaryAsync(p => p.Id, ct);
        foreach (var info in All)
        {
            if (!rows.TryGetValue(info.Id, out var row))
            {
                row = new Person { Id = info.Id };
                db.People.Add(row);
            }
            row.Name = info.Name;
            row.Email = info.Email;
        }
        await db.SaveChangesAsync(ct);
    }
}
