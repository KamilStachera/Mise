using Microsoft.EntityFrameworkCore;
using Mise.Api.Data;
using Mise.Api.Domain;
using Mise.Api.Services;
using Xunit;

namespace Mise.Api.Tests;

public class StockReliabilityTests
{
    private static readonly DateTimeOffset Now = new(2026, 7, 20, 12, 0, 0, TimeSpan.Zero);

    [Fact]
    public void ConfirmationSetsEstimateAndPlanningFloor()
    {
        var item = Item(PantryCategory.Fridge, 100, 0, null);
        new StockReliability().Confirm(item, 350, Now);

        Assert.Equal(350, item.Quantity);
        Assert.Equal(350, StockReliability.PlanningQuantity(item, Now));
        Assert.Equal("confirmed", StockReliability.Confidence(item, Now));
    }

    [Fact]
    public void MigratedZeroWithoutObservationIsNotReportedAsConfirmed()
    {
        var item = Item(PantryCategory.Pantry, 0, 0, null);
        Assert.Equal("stale", StockReliability.Confidence(item, Now));
    }

    [Theory]
    [InlineData(PantryCategory.Produce, 5)]
    [InlineData(PantryCategory.Fridge, 8)]
    [InlineData(PantryCategory.Pantry, 31)]
    [InlineData(PantryCategory.Spices, 91)]
    public void PlanningFloorExpiresByCategory(PantryCategory category, int ageDays)
    {
        var item = Item(category, 300, 300, Now.AddDays(-ageDays));

        Assert.Equal(0, StockReliability.PlanningQuantity(item, Now));
        Assert.Equal("stale", StockReliability.Confidence(item, Now));
        Assert.Equal(300, item.Quantity);
    }

    [Fact]
    public void ReceiptAddsOnlyTheNewPurchaseWhenPreviousFloorIsStale()
    {
        var item = Item(PantryCategory.Fridge, 200, 200, Now.AddDays(-8));
        new StockReliability().ApplyReceiptDelta(item, 500, Now);

        Assert.Equal(700, item.Quantity);
        Assert.Equal(500, StockReliability.PlanningQuantity(item, Now));
        Assert.Equal("estimated", StockReliability.Confidence(item, Now));
    }

    [Fact]
    public void CookingUsesTwentyPercentSafetyMarginForPlanning()
    {
        var item = Item(PantryCategory.Pantry, 500, 500, Now);
        var taken = new StockReliability().ApplyCookDeduction(item, 100, Now);

        Assert.Equal(100, taken);
        Assert.Equal(400, item.Quantity);
        Assert.Equal(380, StockReliability.PlanningQuantity(item, Now));
        Assert.Equal("estimated", StockReliability.Confidence(item, Now));
    }

    [Fact]
    public async Task ShoppingPreviewAsksOnlyWhenUncertaintyChangesPurchase()
    {
        await using var db = NewDb();
        var rice = Item(PantryCategory.Pantry, 250, 100, Now);
        rice.Name = "Ryż";
        rice.Unit = PantryUnit.G;
        db.PantryItems.Add(rice);
        await db.SaveChangesAsync();
        var ingredient = new RecipeIngredient
        {
            Name = "Ryż", PantryItemId = rice.Id, AmountValue = 200,
            AmountUnit = PantryUnit.G, Quantity = "200 g",
        };
        var source = new ShoppingRecipeSource("plan:a", "Risotto",
            new Recipe { Title = "Risotto", Ingredients = new() { ingredient } });

        var preview = await new ShoppingService().PreviewAsync(
            db, new[] { source }, new DateOnly(2026, 7, 20), 7);

        var row = Assert.Single(preview.Items);
        Assert.True(row.NeedsConfirmation);
        Assert.Equal(0, row.EstimatedPurchase);
        Assert.Equal(100, row.SuggestedPurchase);

        new StockReliability().Confirm(rice, 250, DateTimeOffset.UtcNow);
        await db.SaveChangesAsync();
        preview = await new ShoppingService().PreviewAsync(
            db, new[] { source }, new DateOnly(2026, 7, 20), 7);
        Assert.False(Assert.Single(preview.Items).NeedsConfirmation);
    }

    private static PantryItem Item(PantryCategory category, decimal quantity,
        decimal reliable, DateTimeOffset? observedAt) => new()
    {
        Category = category,
        Quantity = quantity,
        ReliableQuantity = reliable,
        ReliabilityUpdatedAt = observedAt,
    };

    private static MiseDbContext NewDb() => new(new DbContextOptionsBuilder<MiseDbContext>()
        .UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);
}
