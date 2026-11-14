using Microsoft.EntityFrameworkCore;
using Mise.Api.Data;

namespace Mise.Api.Services;

/// <param name="Key">Stable id the frontend maps to Polish copy and a link.</param>
/// <param name="Optional">Nice to have; doesn't keep the checklist open on its own.</param>
public record FirstStep(string Key, bool Done, bool Optional);

/// <param name="Show">Not dismissed and something required is still open.</param>
public record FirstStepsDto(bool Show, IReadOnlyList<FirstStep> Steps);

/// <summary>
/// The „Pierwsze kroki” checklist for someone new to a kitchen. Every step ticks itself from real
/// data — nothing to mark by hand. Kitchen steps (profile, pantry, recipe) are shared, so a partner
/// who joins later sees the ones the founder already did as done; the rest are the person's own.
/// </summary>
public static class FirstSteps
{
    /// <summary>Starter copies are created with the household; a recipe this much later is their own.</summary>
    private static readonly TimeSpan StarterWindow = TimeSpan.FromMinutes(5);

    public static async Task<FirstStepsDto> BuildAsync(MiseDbContext db, Caller caller, CancellationToken ct = default)
    {
        if (caller.Self is not { } self || caller.HouseholdId is not int householdId)
            return new FirstStepsDto(false, []);

        var person = await db.People.AsNoTracking().FirstAsync(p => p.Id == self.Id, ct);
        var household = await db.Households.AsNoTracking().FirstAsync(h => h.Id == householdId, ct);
        var ownSince = household.CreatedAt + StarterWindow;

        var steps = new List<FirstStep>
        {
            new("profile", await db.ProfileAnswers.AnyAsync(ct)
                || await db.Preferences.AnyAsync(p => p.TasteCuisines != "" || p.HouseholdSummary != "", ct), false),
            new("pantry", await db.PantryItems.AnyAsync(p => p.Quantity > 0, ct), false),
            new("recipe", await db.Recipes.AnyAsync(r => r.CreatedAt > ownSince, ct), false),
            new("plan", await db.PlanEntries.AnyAsync(e => e.PersonId == self.Id && !e.IsCatering, ct), false),
        };
        if (caller.IsOwner)
            steps.Add(new("invite", await db.People.CountAsync(ct) > 1
                || await db.InviteCodes.AnyAsync(i => i.HouseholdId == householdId && i.Kind == Domain.InviteKind.Join, ct), true));
        steps.Add(new("goal", await db.BodyProfiles.AnyAsync(b => b.PersonId == self.Id, ct), true));
        steps.Add(new("training", await db.TrainingProfiles.AnyAsync(t => t.PersonId == self.Id, ct), true));
        if (household.SousEnabled)
            steps.Add(new("sous", await db.ChatMessages.AnyAsync(m => m.SessionId == $"person-{self.Id}" && m.Role == "user", ct), true));

        var show = person.FirstStepsDismissedAt is null && steps.Any(s => !s.Optional && !s.Done);
        return new FirstStepsDto(show, steps);
    }
}
