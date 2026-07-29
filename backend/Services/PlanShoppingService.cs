using Microsoft.EntityFrameworkCore;
using Mise.Api.Data;
using Mise.Api.Domain;

namespace Mise.Api.Services;

public sealed record PlanShoppingSelection(
    IReadOnlyList<ShoppingRecipeSource> Sources,
    IReadOnlyCollection<string> ScopeKeys);

/// <summary>
/// Builds shopping demand from plan entries that have not been cooked yet.
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
            .Where(e => e.Recipe is not null && !IsCooked(e, logs))
            .Select(e => new ShoppingRecipeSource(
                $"plan:{e.Id}", e.Recipe!.Title, RecipeScaling.Scaled(e.Recipe)))
            .ToList();
        var scopeKeys = entries.Select(e => $"plan:{e.Id}").ToList();
        return new PlanShoppingSelection(sources, scopeKeys);
    }

    /// <summary>
    /// A cook-log entry with the same recipe (or dish name, case-insensitive)
    /// within +/-1 day marks a plan entry as cooked.
    /// </summary>
    public static bool IsCooked(PlanEntry entry, IReadOnlyCollection<CookLogEntry> logs)
    {
        var title = entry.Recipe?.Title ?? entry.Title;
        return logs.Any(log =>
            Math.Abs(log.CookedAt.DayNumber - entry.Date.DayNumber) <= 1
            && ((entry.RecipeId is not null && log.RecipeId == entry.RecipeId)
                || string.Equals(log.DishName, title, StringComparison.OrdinalIgnoreCase)));
    }
}
