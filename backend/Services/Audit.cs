using Mise.Api.Data;
using Mise.Api.Domain;

namespace Mise.Api.Services;

/// <summary>
/// Adds an <see cref="AuditEvent"/> for an admin/owner action to the current unit of work — it is
/// saved by the same <c>SaveChangesAsync</c> as the change it describes. The actor comes from the
/// request's <see cref="Caller"/> (their person, else their Google email, else "system").
/// </summary>
public sealed class Audit(MiseDbContext db, Caller caller)
{
    public void Add(string kind, string summary, int? householdId = null, int? targetPersonId = null) =>
        db.AuditEvents.Add(new AuditEvent
        {
            ActorPersonId = caller.Self?.Id,
            ActorName = caller.Self?.Name ?? caller.Email ?? "system",
            HouseholdId = householdId,
            TargetPersonId = targetPersonId,
            Kind = kind,
            Summary = summary.Length > 500 ? summary[..500] : summary,
        });
}
