using Microsoft.EntityFrameworkCore;
using Mise.Api.Data;
using Mise.Api.Domain;
using Mise.Api.Services;
using Xunit;

namespace Mise.Api.Tests;

public class DiaryServiceTests
{
    private static readonly DateOnly Monday = new(2026, 10, 12);

    [Fact]
    public async Task PotSpreadOverThreeDays_IsBoughtOnceAndScaledToThePot()
    {
        await using var db = NewDb();
        var recipe = Gulasz();
        db.Recipes.Add(recipe);
        await db.SaveChangesAsync();

        await new DiaryService(db).CreateCookAsync(recipe.Id, 4, Monday, MealSlot.Dinner,
            [(Monday.AddDays(1), MealSlot.Lunch), (Monday.AddDays(2), MealSlot.Lunch)], null);

        var selection = await PlanShoppingService.LoadAsync(db, Monday, 7);
        var source = Assert.Single(selection.Sources);
        // Base recipe is 2 servings of 500 g beef; a 4-portion pot needs 1000 g.
        Assert.Equal(1000m, Assert.Single(source.Recipe.Ingredients).AmountValue);
        Assert.Equal(3, selection.ScopeKeys.Count);
    }

    [Fact]
    public async Task Fridge_CountsUnassignedPortions_AndEatingOneTakesItOut()
    {
        await using var db = NewDb();
        var recipe = Gulasz();
        db.Recipes.Add(recipe);
        await db.SaveChangesAsync();
        var diary = new DiaryService(db);
        var cook = await diary.CreateCookAsync(recipe.Id, 4, Monday, MealSlot.Dinner,
            [(Monday.AddDays(1), MealSlot.Lunch)], null);

        var fridge = Assert.Single(await diary.FridgeAsync(Monday.AddDays(1)));
        Assert.Equal(2, DiaryService.Remaining(fridge));

        var eaten = await diary.EatFromCookAsync(cook.Id, Monday.AddDays(2), MealSlot.Dinner);
        Assert.True(eaten.IsLeftover);
        Assert.Equal(520, eaten.Kcal);   // snapshot of one portion
        Assert.Equal(1, DiaryService.Remaining(Assert.Single(await diary.FridgeAsync(Monday.AddDays(2)))));

        await diary.DiscardRestAsync(cook.Id);
        Assert.Empty(await diary.FridgeAsync(Monday.AddDays(2)));
    }

    [Fact]
    public async Task Fridge_IgnoresPotsCookedInTheFutureOrLongAgo()
    {
        await using var db = NewDb();
        var recipe = Gulasz();
        db.Recipes.Add(recipe);
        await db.SaveChangesAsync();
        var diary = new DiaryService(db);
        await diary.CreateCookAsync(recipe.Id, 4, Monday.AddDays(3), MealSlot.Dinner, [], null);
        await diary.CreateCookAsync(recipe.Id, 4, Monday.AddDays(-20), MealSlot.Dinner, [], null);

        Assert.Empty(await diary.FridgeAsync(Monday));
    }

    [Fact]
    public async Task CreateCook_RejectsMoreDaysThanPortions()
    {
        await using var db = NewDb();
        var recipe = Gulasz();
        db.Recipes.Add(recipe);
        await db.SaveChangesAsync();

        await Assert.ThrowsAsync<DiaryException>(() => new DiaryService(db).CreateCookAsync(recipe.Id, 2, Monday,
            MealSlot.Dinner, [(Monday.AddDays(1), MealSlot.Lunch), (Monday.AddDays(2), MealSlot.Lunch)], null));
    }

    [Fact]
    public async Task UpdateCook_ReplacesPlannedLeftoversButKeepsEatenOnes()
    {
        await using var db = NewDb();
        var recipe = Gulasz();
        db.Recipes.Add(recipe);
        await db.SaveChangesAsync();
        var diary = new DiaryService(db);
        var cook = await diary.CreateCookAsync(recipe.Id, 4, Monday, MealSlot.Dinner,
            [(Monday.AddDays(1), MealSlot.Lunch), (Monday.AddDays(2), MealSlot.Lunch)], null);
        var tuesday = await db.PlanEntries.SingleAsync(e => e.Date == Monday.AddDays(1));
        DiaryService.SetEaten(tuesday, true);
        await db.SaveChangesAsync();

        await diary.UpdateCookAsync(cook.Id, 5, [(Monday.AddDays(3), MealSlot.Dinner)]);

        var dates = await db.PlanEntries.Where(e => e.CookId == cook.Id).Select(e => e.Date).OrderBy(d => d).ToListAsync();
        Assert.Equal([Monday, Monday.AddDays(1), Monday.AddDays(3)], dates);
        Assert.Equal(2, DiaryService.Remaining((await diary.LoadCookAsync(cook.Id))!));
    }

    [Fact]
    public async Task DeletingTheCookDay_DropsPlannedLeftoversAndKeepsEatenOnes()
    {
        await using var db = NewDb();
        var recipe = Gulasz();
        db.Recipes.Add(recipe);
        await db.SaveChangesAsync();
        var diary = new DiaryService(db);
        var cook = await diary.CreateCookAsync(recipe.Id, 4, Monday, MealSlot.Dinner,
            [(Monday.AddDays(1), MealSlot.Lunch), (Monday.AddDays(2), MealSlot.Lunch)], null);
        var tuesday = await db.PlanEntries.SingleAsync(e => e.Date == Monday.AddDays(1));
        DiaryService.SetEaten(tuesday, true);
        await db.SaveChangesAsync();
        var cookDay = await db.PlanEntries.SingleAsync(e => e.Date == Monday);

        await diary.DeleteEntryAsync(cookDay.Id);

        var left = Assert.Single(await db.PlanEntries.ToListAsync());
        Assert.Equal(tuesday.Id, left.Id);
        Assert.Null(left.CookId);
        Assert.False(left.IsLeftover);
        Assert.Empty(await db.Cooks.ToListAsync());
    }

    [Fact]
    public async Task EatenRecipeEntry_KeepsItsSnapshotWhenTheRecipeChanges()
    {
        await using var db = NewDb();
        var recipe = Gulasz();
        db.Recipes.Add(recipe);
        await db.SaveChangesAsync();
        var entry = await new DiaryService(db).AddEntryAsync(Monday, MealSlot.Lunch, recipe.Id, null, null,
            1.5m, null, null, null, null, null, eaten: true);
        Assert.Equal(780, DiaryService.Nutrition(entry).Kcal);

        recipe.KcalPerServing = 600;
        Assert.Equal(780, DiaryService.Nutrition(entry).Kcal);

        DiaryService.SetEaten(entry, false);   // back to planned → live estimate
        Assert.Equal(900, DiaryService.Nutrition(entry).Kcal);
    }

    [Fact]
    public async Task PlannedRecipeWithoutEstimate_IsMissing_TypedSnackIsNot()
    {
        await using var db = NewDb();
        var recipe = Gulasz();
        recipe.KcalPerServing = null;
        db.Recipes.Add(recipe);
        await db.SaveChangesAsync();
        var diary = new DiaryService(db);

        var planned = await diary.AddEntryAsync(Monday, MealSlot.Dinner, recipe.Id, null, null,
            null, null, null, null, null, null, eaten: false);
        var snack = await diary.AddEntryAsync(Monday, MealSlot.Snack, null, "Kinder Bueno", null,
            null, 43, 245, null, null, null, eaten: true);

        Assert.True(DiaryService.Nutrition(planned).Missing);
        Assert.Equal(245, DiaryService.Nutrition(snack).Kcal);
        Assert.False(PlanShoppingService.IsCookable(snack));
    }

    [Fact]
    public async Task EatenEntries_AreNotBought()
    {
        await using var db = NewDb();
        var recipe = Gulasz();
        db.Recipes.Add(recipe);
        await db.SaveChangesAsync();
        await new DiaryService(db).AddEntryAsync(Monday, MealSlot.Lunch, recipe.Id, null, null,
            1, null, null, null, null, null, eaten: true);

        Assert.Empty((await PlanShoppingService.LoadAsync(db, Monday, 7)).Sources);
    }

    [Fact]
    public async Task FavoriteChip_LogsUsualGramsAndRanksByUse()
    {
        await using var db = NewDb();
        var diary = new DiaryService(db);
        var bueno = await diary.RememberAsync("Kinder Bueno", 570, 8.6m, 37.3m, 49.5m, per100g: true,
            lastGrams: 43, barcode: null);
        await diary.RememberAsync("Latte", 120, null, null, null, false, null, null);

        Assert.Equal(245, DiaryService.ChipKcal(bueno));
        var entry = await diary.LogFavoriteAsync(bueno.Id, Monday, MealSlot.Snack, null);
        Assert.Equal(245, entry.Kcal);
        Assert.Equal(43m, entry.Grams);
        Assert.NotNull(entry.EatenAt);

        var ranked = await diary.FavoritesAsync(includeHidden: false, cap: null);
        Assert.Equal("Kinder Bueno", ranked[0].Name);   // used twice now
    }

    /// <summary>2 servings, 500 g beef, 520 kcal per serving.</summary>
    private static Recipe Gulasz() => new()
    {
        Title = "Gulasz wołowy",
        Servings = 2,
        KcalPerServing = 520,
        ProteinGrams = 38,
        Ingredients =
        [
            new RecipeIngredient { Name = "Wołowina", Quantity = "500 g", AmountValue = 500, AmountUnit = PantryUnit.G },
        ],
    };

    private static MiseDbContext NewDb() => new(new DbContextOptionsBuilder<MiseDbContext>()
        .UseInMemoryDatabase(Guid.NewGuid().ToString())
        .Options);
}
