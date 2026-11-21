using Microsoft.EntityFrameworkCore;
using Mise.Api.Data;
using Mise.Api.Domain;

namespace Mise.Api.Services;

/// <summary>
/// Creates a household: pantry catalog, household-list chips and an empty cooking profile (they fill
/// it in via the questionnaire — never the owner's tastes), plus a private copy of starter recipes from another household
/// (new ids, own photo files, ingredients relinked to the new pantry). Demo recipes only when
/// nothing is copied. Leaves the tenant pointed at the new household.
/// </summary>
public sealed class HouseholdProvisioner(MiseDbContext db, IngredientMatcher matcher, RecipeImageStore images,
    ILogger<HouseholdProvisioner> logger)
{
    public async Task<Household> CreateAsync(string name, StarterMode starter, IReadOnlyCollection<string> sources,
        int? sourceHouseholdId, CancellationToken ct = default)
    {
        var household = new Household { Name = name, SousEnabled = false };
        db.Households.Add(household);
        await db.SaveChangesAsync(ct);

        var starters = starter == StarterMode.None || sourceHouseholdId is null
            ? []
            : await LoadStartersAsync(sourceHouseholdId.Value, starter, sources, ct);

        db.Tenant.UseHousehold(household.Id);
        db.ChangeTracker.Clear();
        await SeedData.EnsureSeededAsync(db, ct, demoRecipes: starters.Count == 0, exampleProfile: false);

        foreach (var source in starters)
            db.Recipes.Add(Copy(source));
        await db.SaveChangesAsync(ct);
        if (starters.Count > 0)
            await DbInitializer.RelinkAndBackfillAsync(db, matcher, ct);

        logger.LogInformation("Household {Id} \"{Name}\" created with {Count} starter recipes", household.Id, name, starters.Count);
        return household;
    }

    /// <summary>Source names the admin can pick from, with how many recipes each has.</summary>
    public static async Task<List<(string Name, int Count)>> SourcesAsync(MiseDbContext db, CancellationToken ct = default) =>
        (await db.Recipes.AsNoTracking().Where(r => r.SourceName != null)
            .GroupBy(r => r.SourceName!).Select(g => new { g.Key, Count = g.Count() }).ToListAsync(ct))
        .OrderByDescending(x => x.Count).Select(x => (x.Key, x.Count)).ToList();

    private async Task<List<Recipe>> LoadStartersAsync(int sourceHousehold, StarterMode starter,
        IReadOnlyCollection<string> sources, CancellationToken ct)
    {
        var previous = db.Tenant.HouseholdId;
        db.Tenant.UseHousehold(sourceHousehold);
        try
        {
            var query = db.Recipes.AsNoTracking()
                .Include(r => r.Ingredients).Include(r => r.Steps).Include(r => r.Images)
                .AsSplitQuery();
            if (starter == StarterMode.Sources)
            {
                var wanted = sources.Select(s => s.ToLower()).ToList();
                query = query.Where(r => r.SourceName != null && wanted.Contains(r.SourceName.ToLower()));
            }
            return await query.ToListAsync(ct);
        }
        finally
        {
            if (previous is int p) db.Tenant.UseHousehold(p);
        }
    }

    /// <summary>A fresh copy owned by the current tenant (HouseholdId 0 = stamped on save).</summary>
    private Recipe Copy(Recipe source) => CloneRecipe(images, source);

    /// <summary>
    /// Clones a recipe into a fresh, unlinked <see cref="Recipe"/> owned by whichever household
    /// saves it (HouseholdId = 0, PantryItemId = null, IsFavorite = false, independent photo copies).
    /// Used both for new-household starter provisioning and cross-household share imports.
    /// </summary>
    public static Recipe CloneRecipe(RecipeImageStore images, Recipe source)
    {
        var id = Guid.NewGuid();
        var now = DateTimeOffset.UtcNow;
        var copy = new Recipe
        {
            Id = id,
            HouseholdId = 0,
            Title = source.Title,
            Source = source.Source,
            SourceName = source.SourceName,
            TimeMinutes = source.TimeMinutes,
            Servings = source.Servings,
            SelectedServings = null,
            Difficulty = source.Difficulty,
            Tint = source.Tint,
            UsesAirFryer = source.UsesAirFryer,
            Blurb = source.Blurb,
            Tip = source.Tip,
            DishType = source.DishType,
            Cuisine = source.Cuisine,
            IsFavorite = false,
            Tags = [..source.Tags],
            KcalPerServing = source.KcalPerServing,
            ProteinGrams = source.ProteinGrams,
            FatGrams = source.FatGrams,
            CarbGrams = source.CarbGrams,
            CreatedAt = now,
            UpdatedAt = now,
            Ingredients = source.Ingredients.OrderBy(i => i.Order).Select(i => new RecipeIngredient
            {
                Id = Guid.NewGuid(),
                RecipeId = id,
                Name = i.Name,
                Quantity = i.Quantity,
                DisplayText = i.DisplayText,
                AlternativeGroup = i.AlternativeGroup,
                Order = i.Order,
                AmountValue = i.AmountValue,
                AmountUnit = i.AmountUnit,
                PantryItemId = null,
            }).ToList(),
            Steps = source.Steps.OrderBy(s => s.Order).Select(s => new RecipeStep
            {
                RecipeId = id,
                Order = s.Order,
                Text = s.Text,
            }).ToList(),
            Images = [],
            ImagePath = null,
        };

        foreach (var image in source.Images.OrderBy(i => i.CreatedAt))
        {
            if (images.CopyFor(copy.Id, image.Path) is not { } path) continue;
            copy.Images.Add(new RecipeImage { RecipeId = copy.Id, Path = path, CreatedAt = image.CreatedAt });
            if (image.Path == source.ImagePath) copy.ImagePath = path;
        }
        if (copy.ImagePath is null && copy.Images.Count > 0) copy.ImagePath = copy.Images[^1].Path;
        return copy;
    }
}
