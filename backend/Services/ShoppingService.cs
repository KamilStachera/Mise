using Microsoft.EntityFrameworkCore;
using Mise.Api.Data;
using Mise.Api.Domain;

namespace Mise.Api.Services;

/// <summary>
/// Recipe → shopping-list logic. The list is standalone: rows come from recipe
/// "add missing" actions, manual adds and agents — a low/empty pantry item never
/// auto-appears (missing ingredients at home are fine).
/// </summary>
public sealed class ShoppingService
{
    /// <summary>
    /// Adds each recipe's short / out-of-stock / unmatched ingredients to the shopping
    /// list, deduplicated against existing rows by name. Rows carry the shortfall
    /// (how much is missing for the recipe) when the amounts are comparable. Used by
    /// the per-recipe "add missing" action and by the weekly plan. Saves internally;
    /// returns how many rows were added.
    /// </summary>
    public async Task<int> AddMissingForRecipesAsync(MiseDbContext db,
        IEnumerable<Recipe> recipesWithIngredients, CancellationToken ct = default)
    {
        var pantryById = await db.PantryItems.AsNoTracking()
            .ToDictionaryAsync(p => p.Id, ct);
        var existingNames = (await db.ShoppingItems.AsNoTracking().ToListAsync(ct))
            .Select(s => s.Name.Trim().ToLowerInvariant()).ToHashSet();

        var added = 0;
        foreach (var recipe in recipesWithIngredients)
        {
            foreach (var ing in recipe.Ingredients)
            {
                var availability = Features.Mapping.IngredientAvailability(ing, pantryById);
                if (!Features.Mapping.IsToBuy(availability.Status)) continue;
                if (!existingNames.Add(ing.Name.Trim().ToLowerInvariant())) continue;

                db.ShoppingItems.Add(new ShoppingItem
                {
                    Name = ing.Name,
                    Category = "Recipe",
                    Reason = $"Do: {recipe.Title}",
                    Origin = ShoppingOrigin.Recipe,
                    Quantity = availability.Shortfall,
                    Unit = availability.Shortfall is not null
                        ? availability.Unit ?? ing.AmountUnit
                        : null,
                    PantryItemId = ing.PantryItemId,
                });
                added++;
            }
        }
        await db.SaveChangesAsync(ct);
        return added;
    }
}
