using System.Collections;
using Mise.Api.Domain;
using Mise.Api.Services;
using Xunit;

namespace Mise.Api.Tests;

/// <summary>
/// <see cref="HouseholdProvisioner.CloneRecipe"/> copies field by field (starter copies, share-link
/// imports). These tests trip when an entity gains a property nobody decided about, so a new
/// recipe field can't silently go missing from copies.
/// </summary>
public class RecipeCloneTests
{
    private static readonly string[] RecipeCopied =
    [
        nameof(Recipe.Title), nameof(Recipe.Source), nameof(Recipe.SourceName), nameof(Recipe.TimeMinutes),
        nameof(Recipe.Servings), nameof(Recipe.Difficulty), nameof(Recipe.Tint), nameof(Recipe.UsesAirFryer),
        nameof(Recipe.Blurb), nameof(Recipe.Tip), nameof(Recipe.DishType), nameof(Recipe.Cuisine),
        nameof(Recipe.Tags), nameof(Recipe.KcalPerServing), nameof(Recipe.ProteinGrams), nameof(Recipe.FatGrams),
        nameof(Recipe.CarbGrams),
    ];

    /// <summary>Per-household state, identity, timestamps and children handled separately.</summary>
    private static readonly string[] RecipeNotCopied =
    [
        nameof(Recipe.HouseholdId), nameof(Recipe.Id), nameof(Recipe.SelectedServings), nameof(Recipe.IsFavorite),
        nameof(Recipe.ImagePath), nameof(Recipe.CreatedAt), nameof(Recipe.UpdatedAt),
        nameof(Recipe.Ingredients), nameof(Recipe.Steps), nameof(Recipe.Images),
    ];

    private static readonly string[] IngredientCopied =
    [
        nameof(RecipeIngredient.Name), nameof(RecipeIngredient.Quantity), nameof(RecipeIngredient.DisplayText),
        nameof(RecipeIngredient.AlternativeGroup), nameof(RecipeIngredient.Order),
        nameof(RecipeIngredient.AmountValue), nameof(RecipeIngredient.AmountUnit),
    ];

    private static readonly string[] IngredientNotCopied =
    [
        nameof(RecipeIngredient.Id), nameof(RecipeIngredient.RecipeId), nameof(RecipeIngredient.Recipe),
        nameof(RecipeIngredient.PantryItemId), nameof(RecipeIngredient.PantryItem),
    ];

    [Theory]
    [InlineData(typeof(Recipe))]
    [InlineData(typeof(RecipeIngredient))]
    public void EveryPropertyIsEitherCopiedOrDeliberatelyNot(Type type)
    {
        var (copied, notCopied) = type == typeof(Recipe)
            ? (RecipeCopied, RecipeNotCopied)
            : (IngredientCopied, IngredientNotCopied);
        var actual = type.GetProperties().Select(p => p.Name).Order().ToList();
        // A new property? Copy it in HouseholdProvisioner.CloneRecipe (or decide it's per household),
        // then list it above.
        Assert.Equal(copied.Concat(notCopied).Order().ToList(), actual);
    }

    [Fact]
    public void CopiedPropertiesCarryTheSourceValues()
    {
        var source = new Recipe
        {
            HouseholdId = 3,
            Title = "Pierogi",
            Source = RecipeSource.Web,
            SourceName = "Babcia",
            TimeMinutes = 90,
            Servings = 4,
            SelectedServings = 6,
            Difficulty = "Średnie",
            Tint = "#123456",
            UsesAirFryer = true,
            Blurb = "Ruskie",
            Tip = "Nie rozgotuj",
            DishType = DishType.Main,
            Cuisine = Cuisine.Polish,
            IsFavorite = true,
            Tags = ["święta", "mrożonki"],
            KcalPerServing = 640,
            ProteinGrams = 18,
            FatGrams = 22,
            CarbGrams = 90,
            Ingredients =
            [
                new RecipeIngredient
                {
                    Name = "Mąka", Quantity = "500 g", DisplayText = "500 g mąki", AlternativeGroup = "a",
                    Order = 2, AmountValue = 500, AmountUnit = PantryUnit.G, PantryItemId = Guid.NewGuid(),
                },
            ],
            Steps = [new RecipeStep { Order = 1, Text = "Zagnieć ciasto." }],
        };

        var copy = HouseholdProvisioner.CloneRecipe(images: null!, source);

        foreach (var name in RecipeCopied)
            AssertSameValue(typeof(Recipe), name, source, copy);
        foreach (var name in IngredientCopied)
            AssertSameValue(typeof(RecipeIngredient), name, source.Ingredients[0], copy.Ingredients[0]);

        Assert.NotEqual(source.Id, copy.Id);
        Assert.Equal(0, copy.HouseholdId);
        Assert.Null(copy.SelectedServings);
        Assert.False(copy.IsFavorite);
        Assert.Null(copy.Ingredients[0].PantryItemId);
        Assert.NotSame(source.Tags, copy.Tags);
        Assert.Equal("Zagnieć ciasto.", Assert.Single(copy.Steps).Text);
    }

    private static void AssertSameValue(Type type, string name, object source, object copy)
    {
        var prop = type.GetProperty(name)!;
        var (a, b) = (prop.GetValue(source), prop.GetValue(copy));
        if (a is IEnumerable ea and not string && b is IEnumerable eb)
            Assert.Equal(ea.Cast<object>(), eb.Cast<object>());
        else
            Assert.True(Equals(a, b), $"{type.Name}.{name}: expected {a}, got {b}");
    }
}
