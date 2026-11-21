using Mise.Api.Domain;
using Mise.Api.Services;
using Xunit;

namespace Mise.Api.Tests;

public class RecipeNutritionEstimatorTests
{
    [Fact]
    public void Parse_RoundsAndKeepsTheNote()
    {
        var e = RecipeNutritionEstimator.Parse("""{"kcal": 512.6, "protein": 31.24, "fat": 18.06, "carbs": 52, "note": "Najwięcej daje ser."}""");

        Assert.NotNull(e);
        Assert.Equal(513, e.Kcal);
        Assert.Equal(31.2m, e.Protein);
        Assert.Equal(18.1m, e.Fat);
        Assert.Equal(52m, e.Carbs);
        Assert.Equal("Najwięcej daje ser.", e.Note);
    }

    [Theory]
    [InlineData("""{"kcal": 0, "protein": 1, "fat": 1, "carbs": 1, "note": ""}""")]      // no kcal
    [InlineData("""{"kcal": 9000, "protein": 1, "fat": 1, "carbs": 1, "note": ""}""")]   // a whole pot, not a portion
    [InlineData("""{"kcal": 400, "protein": -2, "fat": 1, "carbs": 1, "note": ""}""")]
    [InlineData("""{"kcal": 400}""")]
    [InlineData("nie wiem")]
    public void Parse_RejectsImplausibleOrBrokenReplies(string text)
    {
        Assert.Null(RecipeNutritionEstimator.Parse(text));
    }

    [Fact]
    public void Prompt_AsksForOnePortionOfTheWholeRecipe_WithAmountsAndAlternatives()
    {
        var recipe = new Recipe
        {
            Title = "Makaron z serem",
            Servings = 4,
            Ingredients =
            [
                new RecipeIngredient { Name = "Makaron", Quantity = "400 g", AmountValue = 400, AmountUnit = PantryUnit.G, Order = 0 },
                new RecipeIngredient { Name = "Ser żółty", Quantity = "80 g", AmountValue = 80, AmountUnit = PantryUnit.G, Order = 1 },
                new RecipeIngredient { Name = "Marchew", Quantity = "100 g", AlternativeGroup = "warzywo", Order = 2 },
            ],
        };

        var prompt = RecipeNutritionEstimator.BuildPrompt(recipe);

        Assert.Contains("4 porcje", prompt);
        Assert.Contains("podziel przez 4", prompt);
        Assert.Contains("- Ser żółty: 80 g [80 g]", prompt);
        Assert.Contains("licz tylko jedną opcję z grupy", prompt);
    }
}
