using Microsoft.EntityFrameworkCore;
using Mise.Api.Data;
using Mise.Api.Domain;

namespace Mise.Api.Services;

public sealed record PlanShoppingSelection(
    IReadOnlyList<ShoppingRecipeSource> Sources,
    IReadOnlyCollection<string> ScopeKeys);

/// <summary>
/// Builds shopping demand from plan entries that have not been cooked yet. Each entry
/// buys its own portions (×1 = one person); a pot's cook day buys the whole pot.
/// The cooked matching rule is shared with the plan grid and pending-cook reminder.
/// </summary>
public static class PlanShoppingService
{
    public static async Task<PlanShoppingSelection> LoadAsync(
        MiseDbContext db, DateOnly from, int days)
    {
        var to = from.AddDays(days);
        var entries = await db.PlanEntries.AsNoTracking()
            .Include(e => e.Recipe)!
                .ThenInclude(r => r!.Ingredients)
            .Include(e => e.Cook)
            .AsSplitQuery()
            .Where(e => e.Date >= from && e.Date < to && e.RecipeId != null)
            .ToListAsync();

        if (entries.Count == 0)
            return new PlanShoppingSelection([], []);

        // A log from the day before/after a planned meal can still mark it as cooked.
        var logs = await db.CookLog.AsNoTracking()
            .Where(c => c.CookedAt >= from.AddDays(-1) && c.CookedAt <= to)
            .ToListAsync();

        var sources = entries
            .Where(e => e.Recipe is not null && NeedsShopping(e) && !IsCooked(e, logs))
            .Select(e => new ShoppingRecipeSource(
                $"plan:{e.Id}", e.Recipe!.Title,
                RecipeScaling.ScaledTo(e.Recipe, e.Cook?.Portions ?? e.Portions)))
            .ToList();
        var scopeKeys = entries.Select(e => $"plan:{e.Id}").ToList();
        return new PlanShoppingSelection(sources, scopeKeys);
    }

    /// <summary>
    /// Leftovers are never bought (the cook day already buys the whole pot) and neither is
    /// anything already eaten — she evidently had it.
    /// </summary>
    public static bool NeedsShopping(PlanEntry e) => !e.IsLeftover && e.EatenAt is null;

    /// <summary>
    /// A cook-log entry with the same recipe (or dish name, case-insensitive)
    /// within +/-1 day marks a plan entry as cooked. Leftovers are matched on their
    /// pot's cook day (needs <see cref="PlanEntry.Cook"/> loaded).
    /// </summary>
    public static bool IsCooked(PlanEntry entry, IReadOnlyCollection<CookLogEntry> logs)
    {
        var title = entry.Recipe?.Title ?? entry.Title;
        var date = entry.IsLeftover && entry.Cook is not null ? entry.Cook.Date : entry.Date;
        return logs.Any(log =>
            Math.Abs(log.CookedAt.DayNumber - date.DayNumber) <= 1
            && ((entry.RecipeId is not null && log.RecipeId == entry.RecipeId)
                || string.Equals(log.DishName, title, StringComparison.OrdinalIgnoreCase)));
    }

    /// <summary>
    /// Whether an entry is something you cook (and so belongs in the "did you log it?"
    /// reminder): saved recipes on their cook day, or typed meals without kcal. Leftovers,
    /// snacks and typed food with kcal are diary logs, not cooking.
    /// </summary>
    public static bool IsCookable(PlanEntry e) =>
        e.RecipeId is not null ? !e.IsLeftover : e.Slot != MealSlot.Snack && e.Kcal is null;
}
