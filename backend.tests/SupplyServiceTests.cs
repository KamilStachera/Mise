using Microsoft.EntityFrameworkCore;
using Mise.Api.Data;
using Mise.Api.Domain;
using Mise.Api.Services;
using Xunit;

namespace Mise.Api.Tests;

public class SupplyServiceTests
{
    [Theory]
    [InlineData("Papier toaletowy", SupplyCategory.Paper)]
    [InlineData("Ręczniki papierowe", SupplyCategory.Paper)]
    [InlineData("Płyn do naczyń", SupplyCategory.Cleaning)]
    [InlineData("Proszek do prania", SupplyCategory.Cleaning)]
    [InlineData("Pasta do zębów", SupplyCategory.Hygiene)]
    [InlineData("Worki na śmieci", SupplyCategory.Kitchen)]
    [InlineData("Karma dla kota", SupplyCategory.Pets)]
    [InlineData("Coś dziwnego", SupplyCategory.Other)]
    public void Guess_MapsCommonPolishNamesToCategories(string name, SupplyCategory expected)
        => Assert.Equal(expected, SupplyService.Guess(name));

    [Fact]
    public async Task Add_ExistingUncheckedItem_IsIdempotentAndDoesNotBumpCount()
    {
        await using var db = NewDb();
        var supplies = new SupplyService(db);

        await supplies.AddAsync("Papier toaletowy", null);
        await supplies.AddAsync("papier toaletowy ", null);

        Assert.Single(await db.SupplyItems.ToListAsync());
        var favorite = Assert.Single(await db.SupplyFavorites.ToListAsync());
        Assert.Equal(1, favorite.AddCount);
    }

    [Fact]
    public async Task Add_ExistingCheckedItem_UnchecksInsteadOfDuplicating()
    {
        await using var db = NewDb();
        var supplies = new SupplyService(db);

        var first = await supplies.AddAsync("Papier toaletowy", null);
        first.Checked = true;
        await db.SaveChangesAsync();

        var second = await supplies.AddAsync("Papier toaletowy", null);

        Assert.Equal(first.Id, second.Id);
        Assert.False(second.Checked);
        Assert.Single(await db.SupplyItems.ToListAsync());
        Assert.Equal(2, (await db.SupplyFavorites.SingleAsync()).AddCount);
    }

    [Fact]
    public async Task Add_DifferentSpelling_HitsSameFavorite()
    {
        await using var db = NewDb();
        var supplies = new SupplyService(db);

        var item = await supplies.AddAsync("Mydło w płynie", null);
        db.SupplyItems.Remove(item);
        await db.SaveChangesAsync();

        await supplies.AddAsync("MYDLO W PLYNIE", null);

        var favorite = Assert.Single(await db.SupplyFavorites.ToListAsync());
        Assert.Equal(2, favorite.AddCount);
        // The display form follows the latest spelling used.
        Assert.Equal("MYDLO W PLYNIE", favorite.Name);
    }

    [Fact]
    public async Task Add_ExplicitCategory_OverridesTheGuess()
    {
        await using var db = NewDb();
        var supplies = new SupplyService(db);

        var item = await supplies.AddAsync("Papier toaletowy", SupplyCategory.Other);

        Assert.Equal(SupplyCategory.Other, item.Category);
    }

    [Fact]
    public async Task Hot_PinnedFirst_HiddenExcluded_OnListExcluded()
    {
        await using var db = NewDb();
        var now = DateTimeOffset.UtcNow;
        db.SupplyFavorites.AddRange(
            Favorite("Papier toaletowy", count: 9, last: now),
            Favorite("Szampon", count: 1, last: now, pinned: true),
            Favorite("Proszek do prania", count: 7, last: now, hidden: true),
            Favorite("Worki na śmieci", count: 5, last: now));
        db.SupplyItems.Add(new SupplyItem { Name = "Worki na śmieci" });
        await db.SaveChangesAsync();

        var hot = await new SupplyService(db).HotAsync();

        Assert.Equal(new[] { "Szampon", "Papier toaletowy" },
            hot.Select(h => h.Favorite.Name).ToArray());
    }

    [Fact]
    public async Task Hot_CheckedItemIsStillSuggested()
    {
        await using var db = NewDb();
        db.SupplyFavorites.Add(Favorite("Papier toaletowy", count: 3, last: DateTimeOffset.UtcNow));
        // Already bought this round — but it belongs in the vocabulary for the next one.
        db.SupplyItems.Add(new SupplyItem { Name = "Papier toaletowy", Checked = true });
        await db.SaveChangesAsync();

        var hot = await new SupplyService(db).HotAsync();

        Assert.Equal("Papier toaletowy", Assert.Single(hot).Favorite.Name);
    }

    [Fact]
    public async Task Hot_OldBurst_RanksBelowRecentRegular()
    {
        await using var db = NewDb();
        var now = DateTimeOffset.UtcNow;
        db.SupplyFavorites.AddRange(
            Favorite("Stary hit", count: 12, last: now.AddDays(-400)),
            Favorite("Świeży zwyczaj", count: 4, last: now.AddDays(-3)));
        await db.SaveChangesAsync();

        var hot = await new SupplyService(db).HotAsync();

        Assert.Equal(new[] { "Świeży zwyczaj", "Stary hit" },
            hot.Select(h => h.Favorite.Name).ToArray());
    }

    [Fact]
    public async Task Hot_SeededSuggestions_SortAfterAnythingActuallyUsed()
    {
        await using var db = NewDb();
        db.SupplyFavorites.AddRange(
            Favorite("Aaa nigdy nieużywane", count: 0, last: null),
            Favorite("Żywe użycie", count: 1, last: DateTimeOffset.UtcNow.AddDays(-200)));
        await db.SaveChangesAsync();

        var hot = await new SupplyService(db).HotAsync();

        Assert.Equal("Żywe użycie", hot[0].Favorite.Name);
    }

    [Fact]
    public async Task Add_ReAddingHiddenFavorite_UnhidesIt()
    {
        await using var db = NewDb();
        db.SupplyFavorites.Add(Favorite("Szampon", count: 2, last: DateTimeOffset.UtcNow, hidden: true));
        await db.SaveChangesAsync();

        var supplies = new SupplyService(db);
        var item = await supplies.AddAsync("Szampon", null);
        db.SupplyItems.Remove(item);
        await db.SaveChangesAsync();

        Assert.Equal("Szampon", Assert.Single(await supplies.HotAsync()).Favorite.Name);
    }

    [Fact]
    public async Task AllFavorites_IncludesHiddenAndIsNotCapped()
    {
        await using var db = NewDb();
        var now = DateTimeOffset.UtcNow;
        for (var i = 0; i < SupplyService.HotCap + 3; i++)
            db.SupplyFavorites.Add(Favorite($"Rzecz {i:00}", count: i + 1, last: now));
        db.SupplyFavorites.Add(Favorite("Ukryte", count: 99, last: now, hidden: true));
        await db.SaveChangesAsync();

        var all = await new SupplyService(db).AllFavoritesAsync();

        Assert.Equal(SupplyService.HotCap + 4, all.Count);
        Assert.Contains(all, h => h.Favorite.Name == "Ukryte");
    }

    private static SupplyFavorite Favorite(string name, int count, DateTimeOffset? last,
        bool pinned = false, bool hidden = false)
        => new()
        {
            Name = name,
            NormalizedName = SupplyService.Key(name),
            Category = SupplyService.Guess(name),
            AddCount = count,
            LastAddedAt = last,
            Pinned = pinned,
            Hidden = hidden,
        };

    private static MiseDbContext NewDb()
    {
        var options = new DbContextOptionsBuilder<MiseDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;
        return new MiseDbContext(options);
    }
}
