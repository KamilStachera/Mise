using Microsoft.EntityFrameworkCore;
using Mise.Api.Data;
using Mise.Api.Domain;
using Mise.Api.Features;
using Mise.Api.Services;
using Xunit;

namespace Mise.Api.Tests;

public class ShoppingServiceTests
{
    [Fact]
    public async Task SameCatalogItemThroughAliases_IsOneSummedRow()
    {
        await using var db = NewDb();
        var chicken = Pantry("Mięso z piersi kurczaka", PantryUnit.G, 0,
            "pierś z kurczaka;filet z kurczaka");
        db.PantryItems.Add(chicken);
        await db.SaveChangesAsync();

        var result = await Add(db,
            Source("plan:a", "Curry", Ingredient("Pierś z kurczaka", chicken, 200, PantryUnit.G)),
            Source("plan:b", "Sałatka", Ingredient("Filet z kurczaka", chicken, 150, PantryUnit.G)));

        var row = Assert.Single(await db.ShoppingItems.Include(x => x.Contributions).ToListAsync());
        Assert.Equal(1, result.Added);
        Assert.Equal(0, result.Updated);
        Assert.Equal("Mięso z piersi kurczaka", row.Name);
        Assert.Equal(350, row.Quantity);
        Assert.Equal(PantryUnit.G, row.Unit);
        Assert.Equal(2, row.Contributions.Count);
        Assert.Equal("Do: Curry; Sałatka", row.Reason);
    }

    [Fact]
    public async Task CombinedDemand_SubtractsPantryStockOnlyOnce()
    {
        await using var db = NewDb();
        var chicken = Pantry("Mięso z piersi kurczaka", PantryUnit.G, 100);
        db.PantryItems.Add(chicken);
        await db.SaveChangesAsync();

        await Add(db,
            Source("plan:a", "Curry", Ingredient("Kurczak", chicken, 200, PantryUnit.G)),
            Source("plan:b", "Wrap", Ingredient("Kurczak", chicken, 150, PantryUnit.G)));

        Assert.Equal(250, (await db.ShoppingItems.SingleAsync()).Quantity);
    }

    [Fact]
    public async Task RepeatingSameRecipeSource_IsIdempotent()
    {
        await using var db = NewDb();
        var chicken = Pantry("Mięso z piersi kurczaka", PantryUnit.G, 0);
        db.PantryItems.Add(chicken);
        await db.SaveChangesAsync();
        var source = Source("recipe:one", "Curry",
            Ingredient("Pierś z kurczaka", chicken, 200, PantryUnit.G));

        var first = await Add(db, source);
        var second = await Add(db, source);

        Assert.Equal(new ShoppingAddResult(1, 0), first);
        Assert.Equal(new ShoppingAddResult(0, 0), second);
        var row = await db.ShoppingItems.Include(x => x.Contributions).SingleAsync();
        Assert.Equal(200, row.Quantity);
        Assert.Single(row.Contributions);
    }

    [Fact]
    public async Task SecondSourceJoiningAnExistingRow_InALaterRequest_IsSaved()
    {
        // Each request gets a fresh context: the row is loaded from the database,
        // so the new contribution must be inserted, not updated (the 18 Oct 500s).
        var name = Guid.NewGuid().ToString();
        var rice = Pantry("Ryż", PantryUnit.G, 0);
        await using (var db = NewDb(name))
        {
            db.PantryItems.Add(rice);
            await db.SaveChangesAsync();
            await Add(db, Source("plan:monday", "Risotto", Ingredient("Ryż", rice, 100, PantryUnit.G)));
        }

        await using (var db = NewDb(name))
        {
            var result = await new ShoppingService().AddMissingForRecipesAsync(db, new[]
            {
                Source("plan:monday", "Risotto", Ingredient("Ryż", rice, 100, PantryUnit.G)),
                Source("plan:friday", "Bowl", Ingredient("Ryż", rice, 150, PantryUnit.G)),
            });
            Assert.Equal(new ShoppingAddResult(0, 1), result);
        }

        await using (var db = NewDb(name))
        {
            var row = await db.ShoppingItems.Include(x => x.Contributions).SingleAsync();
            Assert.Equal(250, row.Quantity);
            Assert.Equal(2, row.Contributions.Count);
        }
    }

    [Fact]
    public async Task DistinctPlanEntriesForSameRecipe_CountTwiceAndAnnotateReason()
    {
        await using var db = NewDb();
        var rice = Pantry("Ryż", PantryUnit.G, 0);
        db.PantryItems.Add(rice);
        await db.SaveChangesAsync();
        var recipe = Recipe("Bowl", Ingredient("Ryż", rice, 100, PantryUnit.G));

        await Add(db,
            new ShoppingRecipeSource("plan:monday", recipe.Title, recipe),
            new ShoppingRecipeSource("plan:thursday", recipe.Title, recipe));

        var row = await db.ShoppingItems.SingleAsync();
        Assert.Equal(200, row.Quantity);
        Assert.Equal("Do: Bowl ×2", row.Reason);
    }

    [Fact]
    public async Task ManualAndCheckedRows_AreNeverMerged()
    {
        await using var db = NewDb();
        var rice = Pantry("Ryż", PantryUnit.G, 0);
        db.PantryItems.Add(rice);
        db.ShoppingItems.AddRange(
            new ShoppingItem
            {
                Name = "Ryż", Origin = ShoppingOrigin.Manual, Quantity = 50,
                Unit = PantryUnit.G, PantryItemId = rice.Id,
            },
            new ShoppingItem
            {
                Name = "Ryż", Origin = ShoppingOrigin.Recipe, Checked = true,
                Quantity = 75, Unit = PantryUnit.G, PantryItemId = rice.Id,
            });
        await db.SaveChangesAsync();

        await Add(db, Source("recipe:rice", "Risotto",
            Ingredient("Ryż", rice, 100, PantryUnit.G)));

        var rows = await db.ShoppingItems.ToListAsync();
        Assert.Equal(3, rows.Count);
        Assert.Single(rows, x => !x.Checked && x.Origin == ShoppingOrigin.Recipe);
        Assert.Equal(50, rows.Single(x => x.Origin == ShoppingOrigin.Manual).Quantity);
        Assert.Equal(75, rows.Single(x => x.Checked).Quantity);
    }

    [Fact]
    public async Task TwoLinesForSameProductInOneRecipe_AreSummed()
    {
        await using var db = NewDb();
        var oil = Pantry("Oliwa z oliwek", PantryUnit.Ml, 0);
        db.PantryItems.Add(oil);
        await db.SaveChangesAsync();

        await Add(db, Source("recipe:oil", "Pieczone warzywa",
            Ingredient("Oliwa", oil, 15, PantryUnit.Ml),
            Ingredient("Oliwa do sosu", oil, 10, PantryUnit.Ml)));

        var row = await db.ShoppingItems.Include(x => x.Contributions).SingleAsync();
        Assert.Equal(25, row.Quantity);
        Assert.Single(row.Contributions);
        Assert.Equal(25, row.Contributions[0].RequiredQuantity);
    }

    [Fact]
    public async Task UnknownOrIncompatibleAmount_DoesNotExposeMisleadingNumber()
    {
        await using var db = NewDb();
        var bread = Pantry("Pieczywo", PantryUnit.G, 0);
        db.PantryItems.Add(bread);
        await db.SaveChangesAsync();

        await Add(db,
            Source("plan:a", "Grzanki", Ingredient("Pieczywo", bread, 200, PantryUnit.G)),
            Source("plan:b", "Bruschetta", new RecipeIngredient
            {
                Name = "Pieczywo", PantryItemId = bread.Id,
                Quantity = "2–4 kromki", DisplayText = "2–4 kromki chleba na zakwasie piwnym",
            }));

        var row = await db.ShoppingItems.SingleAsync();
        Assert.Null(row.Quantity);
        Assert.Null(row.Unit);
    }

    [Fact]
    public async Task KnownShortageStillCreatesRowWhenAnotherContributionIsUnquantified()
    {
        await using var db = NewDb();
        var bread = Pantry("Pieczywo", PantryUnit.G, 100);
        db.PantryItems.Add(bread);
        await db.SaveChangesAsync();

        await Add(db,
            Source("plan:a", "Grzanki", Ingredient("Pieczywo", bread, 200, PantryUnit.G)),
            Source("plan:b", "Bruschetta", new RecipeIngredient
            {
                Name = "Pieczywo", PantryItemId = bread.Id, Quantity = "2–4 kromki",
            }));

        var row = await db.ShoppingItems.SingleAsync();
        Assert.Null(row.Quantity);
        Assert.Null(row.Unit);
    }

    [Fact]
    public async Task UnlinkedNamesMergeOnlyByNormalizedCanonicalName()
    {
        await using var db = NewDb();

        await Add(db,
            Source("plan:a", "A", new RecipeIngredient
            {
                Name = "Tofu wędzone", AmountValue = 100, AmountUnit = PantryUnit.G,
            }),
            Source("plan:b", "B", new RecipeIngredient
            {
                Name = "tofu wedzone", AmountValue = 50, AmountUnit = PantryUnit.G,
            }),
            Source("plan:c", "C", new RecipeIngredient
            {
                Name = "Tofu naturalne", AmountValue = 80, AmountUnit = PantryUnit.G,
            }));

        var rows = await db.ShoppingItems.OrderBy(x => x.Name).ToListAsync();
        Assert.Equal(2, rows.Count);
        Assert.Equal(150, rows.Single(x => IngredientMatcher.Normalize(x.Name) == "tofu wedzone").Quantity);
        Assert.Equal(80, rows.Single(x => IngredientMatcher.Normalize(x.Name) == "tofu naturalne").Quantity);
    }

    [Fact]
    public async Task FullyCoveredCombinedPlan_DoesNotCreateShoppingRow()
    {
        await using var db = NewDb();
        var rice = Pantry("Ryż", PantryUnit.G, 250);
        db.PantryItems.Add(rice);
        await db.SaveChangesAsync();

        var result = await Add(db,
            Source("plan:a", "A", Ingredient("Ryż", rice, 100, PantryUnit.G)),
            Source("plan:b", "B", Ingredient("Ryż", rice, 120, PantryUnit.G)));

        Assert.Equal(new ShoppingAddResult(0, 0), result);
        Assert.Empty(await db.ShoppingItems.ToListAsync());
    }

    [Fact]
    public async Task RefreshingSourceThatIsNowCovered_RemovesManagedRowAndReportsUpdate()
    {
        await using var db = NewDb();
        var rice = Pantry("Ryż", PantryUnit.G, 0);
        db.PantryItems.Add(rice);
        await db.SaveChangesAsync();
        var source = Source("recipe:rice", "Risotto", Ingredient("Ryż", rice, 100, PantryUnit.G));
        await Add(db, source);

        new StockReliability().Confirm(rice, 200);
        await db.SaveChangesAsync();
        var result = await Add(db, source);

        Assert.Equal(new ShoppingAddResult(0, 1), result);
        Assert.Empty(await db.ShoppingItems.ToListAsync());
    }

    [Fact]
    public async Task AnyAvailableAlternative_SatisfiesOneRecipeRequirement()
    {
        await using var db = NewDb();
        var carrot = Pantry("Marchew", PantryUnit.G, 250);
        var zucchini = Pantry("Cukinia", PantryUnit.G, 0);
        db.PantryItems.AddRange(carrot, zucchini);
        await db.SaveChangesAsync();

        var result = await Add(db, Source("recipe:omelette", "Omlet pizza",
            Alternative("Marchew", carrot, "vegetable", 200, PantryUnit.G),
            Alternative("Cukinia", zucchini, "vegetable", 200, PantryUnit.G)));

        Assert.Equal(new ShoppingAddResult(0, 0), result);
        Assert.Empty(await db.ShoppingItems.ToListAsync());
    }

    [Fact]
    public async Task MissingAlternatives_CreateOneExplicitOrRow()
    {
        await using var db = NewDb();
        var carrot = Pantry("Marchew", PantryUnit.G, 0);
        var zucchini = Pantry("Cukinia", PantryUnit.G, 0);
        db.PantryItems.AddRange(carrot, zucchini);
        await db.SaveChangesAsync();

        await Add(db, Source("recipe:omelette", "Omlet pizza",
            Alternative("Marchew", carrot, "vegetable", 200, PantryUnit.G),
            Alternative("Cukinia", zucchini, "vegetable", 200, PantryUnit.G)));

        var row = await db.ShoppingItems.Include(x => x.Contributions).SingleAsync();
        Assert.Equal("Marchew lub Cukinia", row.Name);
        Assert.Null(row.PantryItemId);
        Assert.NotNull(row.AlternativeKey);
        Assert.Null(row.Quantity);
        Assert.Null(row.Unit);
        Assert.Single(row.Contributions);
        Assert.Equal(200, row.Contributions[0].RequiredQuantity);
        Assert.Equal(PantryUnit.G, row.Contributions[0].Unit);
    }

    [Fact]
    public async Task AlternativeStock_IsAllocatedAcrossDistinctPlanOccurrences()
    {
        await using var db = NewDb();
        var carrot = Pantry("Marchew", PantryUnit.G, 200);
        var zucchini = Pantry("Cukinia", PantryUnit.G, 200);
        db.PantryItems.AddRange(carrot, zucchini);
        await db.SaveChangesAsync();
        var recipe = Recipe("Omlet pizza",
            Alternative("Marchew", carrot, "vegetable", 200, PantryUnit.G),
            Alternative("Cukinia", zucchini, "vegetable", 200, PantryUnit.G));

        var covered = await Add(db,
            new ShoppingRecipeSource("plan:monday", recipe.Title, recipe),
            new ShoppingRecipeSource("plan:thursday", recipe.Title, recipe));
        Assert.Equal(new ShoppingAddResult(0, 0), covered);

        await Add(db,
            new ShoppingRecipeSource("plan:monday", recipe.Title, recipe),
            new ShoppingRecipeSource("plan:thursday", recipe.Title, recipe),
            new ShoppingRecipeSource("plan:sunday", recipe.Title, recipe));

        var row = await db.ShoppingItems.Include(x => x.Contributions).SingleAsync();
        Assert.Equal(3, row.Contributions.Count);
        Assert.Equal("Do: Omlet pizza ×3", row.Reason);
    }

    [Fact]
    public void AlternativeRequirement_CountsOnceAndUsesEitherStatus()
    {
        var carrot = Pantry("Marchew", PantryUnit.G, 0);
        var zucchini = Pantry("Cukinia", PantryUnit.G, 250);
        var ingredients = new[]
        {
            Alternative("Marchew", carrot, "vegetable", 200, PantryUnit.G),
            Alternative("Cukinia", zucchini, "vegetable", 200, PantryUnit.G),
        };
        var pantry = new Dictionary<Guid, PantryItem>
        {
            [carrot.Id] = carrot,
            [zucchini.Id] = zucchini,
        };

        var group = Assert.Single(Mapping.IngredientRequirementGroups(ingredients));
        Assert.False(Mapping.RequirementNeedsPurchase(group, pantry));
        Assert.Equal("Marchew lub Cukinia", Mapping.RequirementName(group));
    }

    private static MiseDbContext NewDb(string? name = null)
    {
        var options = new DbContextOptionsBuilder<MiseDbContext>()
            .UseInMemoryDatabase(name ?? Guid.NewGuid().ToString())
            .Options;
        return new MiseDbContext(options);
    }

    private static PantryItem Pantry(string name, PantryUnit unit, decimal quantity,
        string aliases = "") => new()
    {
        Name = name,
        Unit = unit,
        Quantity = quantity,
        ReliableQuantity = quantity,
        ReliabilityUpdatedAt = DateTimeOffset.UtcNow,
        Aliases = aliases,
    };

    private static RecipeIngredient Ingredient(string name, PantryItem pantry,
        decimal amount, PantryUnit unit) => new()
    {
        Name = name,
        PantryItemId = pantry.Id,
        AmountValue = amount,
        AmountUnit = unit,
        Quantity = $"{amount} {unit.ToString().ToLowerInvariant()}",
    };

    private static RecipeIngredient Alternative(string name, PantryItem pantry,
        string group, decimal amount, PantryUnit unit)
    {
        var ingredient = Ingredient(name, pantry, amount, unit);
        ingredient.AlternativeGroup = group;
        return ingredient;
    }

    private static Recipe Recipe(string title, params RecipeIngredient[] ingredients) => new()
    {
        Title = title,
        Ingredients = ingredients.ToList(),
    };

    private static ShoppingRecipeSource Source(string key, string title,
        params RecipeIngredient[] ingredients) => new(key, title, Recipe(title, ingredients));

    private static Task<ShoppingAddResult> Add(MiseDbContext db,
        params ShoppingRecipeSource[] sources) =>
        new ShoppingService().AddMissingForRecipesAsync(db, sources);
}
