using Mise.Api.Domain;
using Mise.Api.Services;
using Xunit;

namespace Mise.Api.Tests;

public class PantryRelinkingTests
{
    [Fact]
    public void RelinkIngredients_ReplacesPartialLinkWithExactMatch()
    {
        var butter = PantryItem("Masło");
        var peanutButter = PantryItem("Masło orzechowe");
        var ingredient = new RecipeIngredient
        {
            Name = "Masło orzechowe",
            PantryItemId = butter.Id,
        };

        new IngredientMatcher().RelinkIngredients(
            new[] { ingredient }, new[] { butter, peanutButter });

        Assert.Equal(peanutButter.Id, ingredient.PantryItemId);
    }

    [Fact]
    public void RelinkIngredients_KeepsExistingExactMatchOverPartialCandidate()
    {
        var butter = PantryItem("Masło");
        var clarifiedButter = PantryItem("Masło klarowane");
        var ingredient = new RecipeIngredient
        {
            Name = "Masło",
            PantryItemId = butter.Id,
        };

        new IngredientMatcher().RelinkIngredients(
            new[] { ingredient }, new[] { clarifiedButter, butter });

        Assert.Equal(butter.Id, ingredient.PantryItemId);
    }

    private static PantryItem PantryItem(string name) => new() { Name = name };
}
