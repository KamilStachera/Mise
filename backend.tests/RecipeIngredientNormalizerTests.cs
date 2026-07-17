using System.Reflection;
using System.Text.Json;
using Mise.Api.Domain;
using Mise.Api.Features;
using Mise.Api.Services;
using Xunit;

namespace Mise.Api.Tests;

public class RecipeIngredientNormalizerTests
{
    [Fact]
    public void AlternativeGroup_IsTrimmedAndPreserved()
    {
        var ingredient = Normalize(new IngredientInput(
            "Marchew", "200 g", AlternativeGroup: "  warzywo  "));

        Assert.Equal("warzywo", ingredient.AlternativeGroup);
    }

    [Theory]
    [InlineData("spód do pizzy / pinsa")]
    [InlineData("Marchew lub cukinia")]
    [InlineData("Polędwica wieprzowa albo pierś z indyka")]
    public void CombinedAlternativeSyntax_IsDetectedBeforeWrite(string name)
    {
        Assert.True(RecipeIngredientNormalizer.ContainsCombinedProductSyntax(name));
    }

    [Theory]
    [InlineData("Czosnek")]
    [InlineData("Pieczywo")]
    [InlineData("1/2 awokado")]
    public void OrdinaryProductName_IsNotRejectedAsAlternative(string name)
    {
        Assert.False(RecipeIngredientNormalizer.ContainsCombinedProductSyntax(name));
    }

    private static readonly IReadOnlyList<PantryItem> Catalog =
    [
        Pantry("Pieczywo", "chleb razowy;chleb żytni;bułka kajzerka"),
        Pantry("Jajka", "jajko"),
        Pantry("Olej rzepakowy", "olej do smażenia"),
        Pantry("Rukola"),
        Pantry("Oliwa z oliwek"),
        Pantry("Sól"),
        Pantry("Marchew z groszkiem"),
        Pantry("Drożdże", "drożdże instant"),
        Pantry("Cebula"),
        Pantry("Czosnek"),
        Pantry("Krem balsamiczny"),
        Pantry("Ziemniaki"),
        Pantry("Woda różana"),
    ];

    public static IEnumerable<object[]> WebIngredientCases()
    {
        using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(
            "Mise.Api.Tests.Fixtures.web-ingredient-cases.json");
        Assert.NotNull(stream);
        var cases = JsonSerializer.Deserialize<List<WebIngredientCase>>(stream!,
            new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
        Assert.NotNull(cases);
        return cases!.Select(x => new object[] { x });
    }

    [Theory]
    [MemberData(nameof(WebIngredientCases))]
    public void PublicRecipeLines_KeepSourceTextAndUseSafeCatalogIdentity(WebIngredientCase test)
    {
        var ingredient = Normalize(new IngredientInput(
            test.InputName, test.Quantity, DisplayText: test.Raw));

        Assert.Equal(test.ExpectedName, ingredient.Name);
        Assert.Equal(test.Quantity, ingredient.Quantity);
        Assert.Equal(test.Raw, ingredient.DisplayText);
        Assert.Equal(test.ExpectedAmountValue, ingredient.AmountValue);
        Assert.Equal(ParseUnit(test.ExpectedAmountUnit), ingredient.AmountUnit);
        Assert.DoesNotMatch(@"^\s*\d", ingredient.Name);
        Assert.StartsWith("https://", test.SourceUrl, StringComparison.Ordinal);
    }

    [Fact]
    public void AliasWithoutDisplayText_IsCanonicalizedAndOriginalLineIsPreserved()
    {
        var ingredient = Normalize(new IngredientInput("Jajko", "2 szt."));

        Assert.Equal("Jajka", ingredient.Name);
        Assert.Equal("2 szt.", ingredient.Quantity);
        Assert.Equal("2 szt. Jajko", ingredient.DisplayText);
        Assert.Equal(2, ingredient.AmountValue);
        Assert.Equal(PantryUnit.Szt, ingredient.AmountUnit);
    }

    [Theory]
    [InlineData("4 kromki chleb razowy", "Pieczywo", "4 kromki")]
    [InlineData("3 ząbki czosnku", "Czosnek", "3 ząbki")]
    [InlineData("1/2 paczki (225 g) Marchew z groszkiem", "Marchew z groszkiem", "1/2 paczki (225 g)")]
    public void QuantityAccidentallyPlacedInName_IsSeparated(
        string rawName, string expectedName, string expectedQuantity)
    {
        var ingredient = Normalize(new IngredientInput(rawName, null));

        Assert.Equal(expectedName, ingredient.Name);
        Assert.Equal(expectedQuantity, ingredient.Quantity);
        Assert.Equal(rawName, ingredient.DisplayText);
    }

    [Theory]
    [InlineData("Orzeszki ziemne")]
    [InlineData("Woda")]
    public void LooseSubstringMatch_DoesNotAssignCatalogIdentity(string inputName)
    {
        var ingredient = Normalize(new IngredientInput(inputName, "100 g"));

        Assert.Equal(inputName, ingredient.Name);
        Assert.Null(ingredient.PantryItemId);
    }

    [Fact]
    public void DuplicatedQuantityAndTruncatedParenthesis_DoNotPolluteCanonicalName()
    {
        var ingredient = Normalize(new IngredientInput(
            "odrobina kremu balsamicznego (opcjonalnie", "Odrobina"));

        Assert.Equal("Krem balsamiczny", ingredient.Name);
        Assert.Equal("Odrobina", ingredient.Quantity);
        Assert.Equal("odrobina kremu balsamicznego (opcjonalnie", ingredient.DisplayText);
        Assert.NotNull(ingredient.PantryItemId);
    }

    [Theory]
    [InlineData("1 porcja (120 g)", 120, PantryUnit.G)]
    [InlineData("3 kromki (105 g)", 105, PantryUnit.G)]
    [InlineData("1/2 paczki (225 g)", 225, PantryUnit.G)]
    public void ExactParentheticalAmount_IsSafeForCalculations(
        string quantity, decimal expectedValue, PantryUnit expectedUnit)
    {
        Assert.True(QuantityParser.TryParse(quantity, out var value, out var unit));
        Assert.Equal(expectedValue, value);
        Assert.Equal(expectedUnit, unit);
    }

    [Theory]
    [InlineData("100–150 g")]
    [InlineData("2–4 kromki (140 g)")]
    public void RangesRemainUnquantified(string quantity)
    {
        Assert.False(QuantityParser.TryParse(quantity, out _, out _));
    }

    private static RecipeIngredient Normalize(IngredientInput input) =>
        new RecipeIngredientNormalizer(new IngredientMatcher()).Create(input, Catalog, 0);

    private static PantryItem Pantry(string name, string aliases = "") => new()
    {
        Name = name,
        Aliases = aliases,
    };

    private static PantryUnit? ParseUnit(string? unit) => unit switch
    {
        "g" => PantryUnit.G,
        "ml" => PantryUnit.Ml,
        "szt" => PantryUnit.Szt,
        _ => null,
    };

    public sealed record WebIngredientCase(
        string SourceUrl,
        string Raw,
        string InputName,
        string Quantity,
        string ExpectedName,
        decimal? ExpectedAmountValue,
        string? ExpectedAmountUnit);
}
