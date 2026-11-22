using Microsoft.EntityFrameworkCore;
using Mise.Api.Data;
using Mise.Api.Domain;
using Mise.Api.Services;
using Xunit;

namespace Mise.Api.Tests;

public class MealSlotsTests
{
    private static readonly DateOnly Monday = new(2026, 10, 12);
    private static readonly PersonScope Her = new(1);
    private static readonly PersonScope Him = new(2);

    [Fact]
    public async Task NobodyHasRows_UntilTheyEdit_DefaultsApply()
    {
        await using var db = NewDb();
        var meals = new MealSlots(db);

        var day = await meals.ListAsync(1);

        Assert.Equal(["breakfast", "lunch", "dinner", "snack"], day.Select(m => m.Key));
        Assert.Equal("lunch", (await meals.ResolveAsync(1, "Obiad"))!.Key);
        Assert.Equal("lunch", (await meals.ResolveAsync(1, "obiad"))!.Key);
        Assert.Equal(0, await db.MealSlots.CountAsync());
    }

    [Fact]
    public async Task AddingLunch_KeepsOldKeys_AndGetsItsOwn()
    {
        await using var db = NewDb();
        var meals = new MealSlots(db);

        var day = await meals.ReplaceAsync(1,
        [
            new("breakfast", "Śniadanie"), new(null, "Lunch"), new("lunch", "Obiad"),
            new("dinner", "Kolacja"), new("snack", "Przekąski", Snack: true),
        ]);

        Assert.Equal(["breakfast", "lunch-2", "lunch", "dinner", "snack"], day.Where(m => m.Active).Select(m => m.Key));
        Assert.Equal("lunch-2", (await meals.ResolveAsync(1, "LUNCH"))!.Key);
        Assert.Equal("lunch", (await meals.ResolveAsync(1, "lunch"))!.Key);   // a key beats a name
    }

    [Fact]
    public async Task RemovedMeal_IsArchived_AndComesBackByName()
    {
        await using var db = NewDb();
        var meals = new MealSlots(db);
        await new DiaryService(db, Her).AddEntryAsync(Monday, "dinner", null, "Kanapki", null,
            null, null, null, null, null, null, eaten: false);

        await meals.ReplaceAsync(1, [new("breakfast", "Śniadanie"), new("lunch", "Obiad")]);
        var ex = await Assert.ThrowsAsync<DiaryException>(() => new DiaryService(db, Her).AddEntryAsync(
            Monday, "dinner", null, "Zupa", null, null, null, null, null, null, null, eaten: false));
        Assert.Contains("breakfast (Śniadanie)", ex.Message);
        var directory = await meals.DirectoryAsync();
        Assert.Equal("Kolacja", directory.Name(1, "dinner"));   // the old entry keeps its name

        var day = await meals.ReplaceAsync(1, [new("breakfast", "Śniadanie"), new("lunch", "Obiad"), new(null, "kolacja")]);
        Assert.Contains(day, m => m.Key == "dinner" && m.Active && m.Name == "kolacja");
    }

    [Fact]
    public async Task Validation_KeepsADayUsable()
    {
        await using var db = NewDb();
        var meals = new MealSlots(db);

        await Assert.ThrowsAsync<DiaryException>(() => meals.ReplaceAsync(1, []));
        await Assert.ThrowsAsync<DiaryException>(() => meals.ReplaceAsync(1, [new(null, "Obiad"), new(null, "obiad ")]));
        await Assert.ThrowsAsync<DiaryException>(() => meals.ReplaceAsync(1, [new(null, "Przekąski", Snack: true)]));
        await Assert.ThrowsAsync<DiaryException>(() => meals.ReplaceAsync(1, [new(null, " ")]));
    }

    [Fact]
    public async Task CustomSnackMeal_IsPrivateAndNeverAsksAboutCooking()
    {
        await using var db = NewDb();
        await new MealSlots(db).ReplaceAsync(1,
            [new("breakfast", "Śniadanie"), new("lunch", "Obiad"), new(null, "Podwieczorek", Snack: true)]);
        var entry = await new DiaryService(db, Her).AddEntryAsync(Monday, "Podwieczorek", null, "Jabłko", null,
            null, null, null, null, null, null, eaten: false);

        var directory = await new MealSlots(db).DirectoryAsync();

        Assert.Equal("podwieczorek", entry.Slot);
        Assert.True(directory.IsSnack(entry));
        Assert.False(PlanShoppingService.IsCookable(entry, directory));
        Assert.True(directory.IsSnack(new PlanEntry { PersonId = 2, Slot = "snack" }));   // no rows = defaults
    }

    [Fact]
    public async Task AlsoFor_LandsInThePartnersMatchingMeal()
    {
        await using var db = NewDb();
        db.People.AddRange(new Person { Id = 1, HouseholdId = 1, Name = "Ola" }, new Person { Id = 2, HouseholdId = 1, Name = "Kamil" });
        await db.SaveChangesAsync();
        var meals = new MealSlots(db);
        await meals.ReplaceAsync(1, [new("breakfast", "Śniadanie"), new(null, "Lunch"), new("lunch", "Obiad")]);
        await meals.ReplaceAsync(2, [new(null, "Lunch"), new("dinner", "Kolacja")]);

        await new DiaryService(db, Her).AddEntryAsync(Monday, "Lunch", null, "Sałatka", null,
            null, null, null, null, null, null, eaten: false, alsoFor: [(2, 1m)]);
        var his = await db.PlanEntries.SingleAsync(e => e.PersonId == 2);
        Assert.Equal("lunch-2", his.Slot);

        // Different keys, same name: her Obiad ("lunch") lands in his „obiad” (key "obiad").
        await meals.ReplaceAsync(2, [new("lunch-2", "Lunch"), new(null, "Obiad"), new("dinner", "Kolacja")]);
        await meals.ReplaceAsync(2, [new("lunch-2", "Lunch"), new("dinner", "Kolacja")]);
        await meals.ReplaceAsync(2, [new("lunch-2", "Lunch"), new(null, "obiad"), new("dinner", "Kolacja")]);
        Assert.Equal("lunch", (await meals.ResolveAsync(2, "obiad"))!.Key);   // revived by name, not a new key

        var ex = await Assert.ThrowsAsync<DiaryException>(() => new DiaryService(db, Her).AddEntryAsync(Monday,
            "breakfast", null, "Owsianka", null, null, null, null, null, null, null, eaten: false, alsoFor: [(2, 1m)]));
        Assert.Contains("Kamil nie ma posiłku „Śniadanie”", ex.Message);
    }

    private static MiseDbContext NewDb() => new(new DbContextOptionsBuilder<MiseDbContext>()
        .UseInMemoryDatabase(Guid.NewGuid().ToString())
        .Options);
}
