using Microsoft.EntityFrameworkCore;
using Mise.Api.Data;
using Mise.Api.Domain;

namespace Mise.Api.Services;

/// <summary>A household's portion settings (<see cref="Household.NewRecipesFullServings"/>, <see cref="Household.KeepIngredientsFixed"/>).</summary>
public sealed record PortionSettings(bool NewRecipesFullServings, bool KeepIngredientsFixed)
{
    public static readonly PortionSettings Default = new(false, false);

    public static async Task<PortionSettings> LoadAsync(MiseDbContext db, int? householdId, CancellationToken ct = default) =>
        householdId is int id
            ? await db.Households.AsNoTracking()
                  .Where(h => h.Id == id)
                  .Select(h => new PortionSettings(h.NewRecipesFullServings, h.KeepIngredientsFixed))
                  .FirstOrDefaultAsync(ct) ?? Default
            : Default;

    /// <summary>A recipe being created opens at its full portion count when the household wants that.</summary>
    public void ApplyToNewRecipe(Recipe recipe)
    {
        if (NewRecipesFullServings && recipe.Servings > RecipeScaling.DefaultServings)
            recipe.SelectedServings = recipe.Servings;
    }
}
