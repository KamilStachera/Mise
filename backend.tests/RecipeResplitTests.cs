using Mise.Api.Domain;
using Mise.Api.Services;
using Xunit;

namespace Mise.Api.Tests;

public class RecipeResplitTests
{
    private static Recipe Pot() => new()
    {
        Servings = 4,
        SelectedServings = 2,
        KcalPerServing = 600,
        ProteinGrams = 30,
        FatGrams = 21,
        CarbGrams = 66.6m,
        Ingredients = [new RecipeIngredient { Name = "Makaron", Quantity = "400 g", AmountValue = 400, AmountUnit = PantryUnit.G }],
    };

    [Fact]
    public void SameDishIntoMorePortions_KeepsTheDishTotal_AndTheIngredients()
    {
        var r = Pot();

        RecipeScaling.Resplit(r, 6);

        Assert.Equal(6, r.Servings);
        Assert.Equal(400, r.KcalPerServing);          // 4 × 600 = 6 × 400
        Assert.Equal(20m, r.ProteinGrams);
        Assert.Equal(14m, r.FatGrams);
        Assert.Equal(44.4m, r.CarbGrams);
        Assert.Equal("400 g", Assert.Single(r.Ingredients).Quantity);
        Assert.Equal(2, r.SelectedServings);          // people eating, still in range
    }

    [Fact]
    public void FewerPortions_MakesEachBigger_AndDropsAnOutOfRangePick()
    {
        var r = Pot();
        r.Servings = 12;
        r.SelectedServings = 10;

        RecipeScaling.Resplit(r, 3);

        Assert.Equal(2400, r.KcalPerServing);
        Assert.Null(r.SelectedServings);              // 10 > max(8, 3)
    }

    [Fact]
    public void FixedIngredients_AlwaysShowTheWholeDish()
    {
        var r = Pot();

        Assert.Equal(2, RecipeScaling.EffectiveServings(r));
        Assert.Equal(200m, RecipeScaling.ScaledIngredients(r)[0].AmountValue);
        Assert.Equal(4, RecipeScaling.EffectiveServings(r, fixedIngredients: true));
        Assert.Same(r.Ingredients, RecipeScaling.ScaledIngredients(r, fixedIngredients: true));
    }

    [Fact]
    public void NewRecipe_OpensAtFullPortions_OnlyWhenTheHouseholdWantsIt()
    {
        var r = new Recipe { Servings = 4 };
        PortionSettings.Default.ApplyToNewRecipe(r);
        Assert.Null(r.SelectedServings);

        new PortionSettings(NewRecipesFullServings: true, KeepIngredientsFixed: false).ApplyToNewRecipe(r);
        Assert.Equal(4, r.SelectedServings);
    }
}
