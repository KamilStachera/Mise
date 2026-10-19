using Microsoft.EntityFrameworkCore;
using Mise.Api.Data;
using Mise.Api.Domain;
using Mise.Api.Services;
using Xunit;

namespace Mise.Api.Tests;

public class PlanShoppingServiceTests
{
    [Fact]
    public async Task CookedPlanEntry_IsExcludedWhileLaterOccurrenceRemains()
    {
        await using var db = NewDb();
        var start = new DateOnly(2026, 7, 20);
        var recipe = new Recipe
        {
            Title = "Curry",
            Ingredients = new List<RecipeIngredient>
            {
                new()
                {
                    Name = "Ryż",
                    Quantity = "200 g",
                    AmountValue = 200,
                    AmountUnit = PantryUnit.G,
                },
            },
        };
        var cookedEntry = new PlanEntry
        {
            Date = start.AddDays(1),
            RecipeId = recipe.Id,
            Recipe = recipe,
        };
        var upcomingEntry = new PlanEntry
        {
            Date = start.AddDays(5),
            RecipeId = recipe.Id,
            Recipe = recipe,
        };
        db.Recipes.Add(recipe);
        db.PlanEntries.AddRange(cookedEntry, upcomingEntry);
        db.CookLog.Add(new CookLogEntry
        {
            RecipeId = recipe.Id,
            DishName = recipe.Title,
            CookedAt = cookedEntry.Date,
        });
        await db.SaveChangesAsync();

        var selection = await PlanShoppingService.LoadAsync(db, start, 7);

        var source = Assert.Single(selection.Sources);
        Assert.Equal($"plan:{upcomingEntry.Id}", source.Key);
        Assert.Equal(2, selection.ScopeKeys.Count);
    }

    [Fact]
    public async Task CookLogOneDayAfterPlanEntry_StillExcludesItFromShopping()
    {
        await using var db = NewDb();
        var start = new DateOnly(2026, 7, 20);
        var recipe = new Recipe { Title = "Zupa" };
        var entry = new PlanEntry
        {
            Date = start.AddDays(2),
            RecipeId = recipe.Id,
            Recipe = recipe,
        };
        db.Recipes.Add(recipe);
        db.PlanEntries.Add(entry);
        db.CookLog.Add(new CookLogEntry
        {
            RecipeId = recipe.Id,
            DishName = recipe.Title,
            CookedAt = entry.Date.AddDays(1),
        });
        await db.SaveChangesAsync();

        var selection = await PlanShoppingService.LoadAsync(db, start, 7);

        Assert.Empty(selection.Sources);
        Assert.Single(selection.ScopeKeys);
    }

    [Fact]
    public async Task Recalculation_RemovesContributionThatWasCookedSincePreviousRun()
    {
        await using var db = NewDb();
        var start = new DateOnly(2026, 7, 20);
        var rice = new PantryItem
        {
            Name = "Ryż",
            Unit = PantryUnit.G,
            Quantity = 0,
            ReliableQuantity = 0,
            ReliabilityUpdatedAt = DateTimeOffset.UtcNow,
        };
        var recipe = new Recipe
        {
            Title = "Curry",
            Servings = 1,
            Ingredients = new List<RecipeIngredient>
            {
                new()
                {
                    Name = rice.Name,
                    PantryItemId = rice.Id,
                    Quantity = "200 g",
                    AmountValue = 200,
                    AmountUnit = PantryUnit.G,
                },
            },
        };
        var cookedEntry = new PlanEntry
        {
            Date = start.AddDays(1), RecipeId = recipe.Id, Recipe = recipe,
        };
        var upcomingEntry = new PlanEntry
        {
            Date = start.AddDays(5), RecipeId = recipe.Id, Recipe = recipe,
        };
        db.PantryItems.Add(rice);
        db.Recipes.Add(recipe);
        db.PlanEntries.AddRange(cookedEntry, upcomingEntry);
        await db.SaveChangesAsync();

        var shopping = new ShoppingService();
        var initial = await PlanShoppingService.LoadAsync(db, start, 7);
        await shopping.AddMissingForRecipesAsync(db, initial.Sources, initial.ScopeKeys);
        Assert.Equal(400, (await db.ShoppingItems.SingleAsync()).Quantity);

        db.CookLog.Add(new CookLogEntry
        {
            RecipeId = recipe.Id,
            DishName = recipe.Title,
            CookedAt = cookedEntry.Date,
        });
        await db.SaveChangesAsync();

        var recalculated = await PlanShoppingService.LoadAsync(db, start, 7);
        await shopping.AddMissingForRecipesAsync(db, recalculated.Sources, recalculated.ScopeKeys);

        var row = await db.ShoppingItems.Include(x => x.Contributions).SingleAsync();
        Assert.Equal(200, row.Quantity);
        var contribution = Assert.Single(row.Contributions);
        Assert.Equal($"plan:{upcomingEntry.Id}", contribution.SourceKey);
    }

    [Fact]
    public async Task PlanEntry_BuysItsOwnPortions_PotBuysTheWholePot()
    {
        await using var db = NewDb();
        var start = new DateOnly(2026, 7, 20);
        // Written for 4; the user's saved choice must not leak into the plan.
        var recipe = new Recipe
        {
            Title = "Gulasz",
            Servings = 4,
            SelectedServings = 3,
            Ingredients = new List<RecipeIngredient>
            {
                new() { Name = "Wołowina", Quantity = "800 g", AmountValue = 800, AmountUnit = PantryUnit.G },
            },
        };
        var single = new PlanEntry { Date = start, RecipeId = recipe.Id, Recipe = recipe, Portions = 1 };
        var doubled = new PlanEntry { Date = start.AddDays(1), RecipeId = recipe.Id, Recipe = recipe, Portions = 1.5m };
        var cook = new Cook { RecipeId = recipe.Id, Date = start.AddDays(2), Portions = 6 };
        var potDay = new PlanEntry { Date = start.AddDays(2), RecipeId = recipe.Id, Recipe = recipe, Cook = cook, Portions = 1 };
        db.Recipes.Add(recipe);
        db.Cooks.Add(cook);
        db.PlanEntries.AddRange(single, doubled, potDay);
        await db.SaveChangesAsync();

        var selection = await PlanShoppingService.LoadAsync(db, start, 7);

        decimal Amount(PlanEntry e) => selection.Sources
            .Single(s => s.Key == $"plan:{e.Id}").Recipe.Ingredients.Single().AmountValue!.Value;
        Assert.Equal(200, Amount(single));
        Assert.Equal(300, Amount(doubled));
        Assert.Equal(1200, Amount(potDay));
    }

    private static MiseDbContext NewDb() => new(new DbContextOptionsBuilder<MiseDbContext>()
        .UseInMemoryDatabase(Guid.NewGuid().ToString())
        .Options);
}
