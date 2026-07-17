using Mise.Api.Domain;
using Mise.Api.Features;
using Mise.Api.Services;
using Xunit;

namespace Mise.Api.Tests;

/// <summary>
/// Deterministic ingredient lines sampled across the current 60-recipe / 446-line
/// pichci export, plus public-web edge cases. No test fetches the network.
/// </summary>
public class IngredientCorpusTests
{
    public static TheoryData<string, string, string> LegacyPichciLines => new()
    {
        { "3 ząbki", "Czosnek", "3 ząbki Czosnek" },
        { "2 łyżki", "Oliwa z oliwek", "2 łyżki Oliwa z oliwek" },
        { "garść", "Bazylia", "garść Bazylia" },
        { "1 puszka", "Ciecierzyca", "1 puszka Ciecierzyca" },
        { "do smaku", "Sól", "do smaku Sól" },
        { "do smaku", "Pieprz", "do smaku Pieprz" },
        { "3 sztuki", "Jajka M", "3 sztuki Jajka M" },
        { "200 g", "Pomidory krojone z puszki", "200 g Pomidory krojone z puszki" },
        { "około 80 ml", "Wrzątek", "około 80 ml Wrzątek" },
        { "0,5 sztuki", "Ogórek", "0,5 sztuki Ogórek" },
        { "350 ml", "Mleko 1,5%", "350 ml Mleko 1,5%" },
        { "opcjonalnie do posypania", "Sezam", "opcjonalnie do posypania Sezam" },
        { "200 g", "Marchewka albo cukinia", "200 g Marchewka albo cukinia" },
        { "0,25 sztuki", "Cukinia", "0,25 sztuki Cukinia" },
        { "6 bez kości", "Udka z kurczaka", "6 bez kości Udka z kurczaka" },
        { "100 g", "Polędwica wieprzowa albo pierś z indyka lub kurczaka", "100 g Polędwica wieprzowa albo pierś z indyka lub kurczaka" },
        { "", "Chleb pszenny", "Chleb pszenny" },
        { "do smaku", "Erytrol, ksylitol albo słodzik", "do smaku Erytrol, ksylitol albo słodzik" },
        { "1 łyżeczka", "Kmin rzymski", "1 łyżeczka Kmin rzymski" },
        { "30 g", "Odżywka białkowa WPC", "30 g Odżywka białkowa WPC" },
        { "150 g", "Skyr naturalny", "150 g Skyr naturalny" },
        { "20 g", "Sos sojowy", "20 g Sos sojowy" },
        { "0,5 sztuki", "Bakłażan", "0,5 sztuki Bakłażan" },
        { "garść", "Rukola", "garść Rukola" },
        { "1 sztuka", "Jajko M", "1 sztuka Jajko M" },
    };

    [Theory]
    [MemberData(nameof(LegacyPichciLines))]
    public void LegacyIngredientWithoutDisplayText_KeepsPreviousPresentation(
        string quantity, string name, string expected)
    {
        var ingredient = new RecipeIngredient { Name = name, Quantity = quantity };

        Assert.Equal(expected, Mapping.IngredientDisplayText(ingredient));
    }

    public static TheoryData<string, string, string> VerbatimLines => new()
    {
        // https://gotujwstylueko.pl/przepisy/bruschetta-po-polsku-
        { "Pieczywo", "2–4 kromki", "2–4 kromki chleba na zakwasie" },
        // https://aniagotuje.pl/przepis/kurczak-curry
        { "Mięso z piersi kurczaka", "650 g", "1 podwójna pierś z kurczaka – 650 g" },
        // https://aniagotuje.pl/przepis/piersi-kurczaka-pieczone-z-warzywami
        { "Mięso z piersi kurczaka", "2 szt.", "2 średnie, całe piersi z kurczaka" },
        { "Olej rzepakowy", "2 łyżki", "2 łyżki oleju, np. ryżowego" },
        { "Pomidory (z puszki)", "400 g", "duża puszka pomidorów – 400 g" },
        { "Pieczywo", "2–4 kromki", "2–4 kromki chleba na zakwasie piwnym" },
        { "Mąka pszenna", "60 g", "4 łyżki mąki pszennej lub kukurydzianej – około 60 g" },
        { "Jajka", "2 szt.", "2 duże jajka – do 120 g po rozbiciu" },
    };

    [Theory]
    [MemberData(nameof(VerbatimLines))]
    public void ExplicitDisplayText_WinsWithoutChangingCanonicalName(
        string name, string quantity, string displayText)
    {
        var ingredient = new RecipeIngredient
        {
            Name = name,
            Quantity = quantity,
            DisplayText = displayText,
        };

        Assert.Equal(displayText, Mapping.IngredientDisplayText(ingredient));
        Assert.Equal(name, ingredient.Name);
    }

    [Theory]
    [InlineData("2–4 kromki")]
    [InlineData("garść")]
    [InlineData("do smaku")]
    [InlineData("1 puszka")]
    [InlineData("2 łyżki")]
    [InlineData("około 80 ml")]
    public void AmbiguousKitchenMeasures_AreNotSilentlyConverted(string quantity)
    {
        Assert.False(QuantityParser.TryParse(quantity, out _, out _));
    }

    [Theory]
    [InlineData("pierś z kurczaka", "Mięso z piersi kurczaka")]
    [InlineData("filet z kurczaka", "Mięso z piersi kurczaka")]
    [InlineData("chleb żytni", "Pieczywo")]
    [InlineData("bułka kajzerka", "Pieczywo")]
    [InlineData("miodu", "Miód")]
    [InlineData("ząbki czosnku", "Czosnek")]
    public void CanonicalNamesAndAliases_MatchExpectedCatalogItem(string input, string expected)
    {
        var pantry = new[]
        {
            new PantryItem { Name = "Mięso z piersi kurczaka", Aliases = "pierś z kurczaka;filet z kurczaka" },
            new PantryItem { Name = "Pieczywo", Aliases = "bułka;bułka kajzerka;chleb żytni;chleb razowy" },
            new PantryItem { Name = "Miód" },
            new PantryItem { Name = "Czosnek" },
        };

        Assert.Equal(expected, new IngredientMatcher().FindMatch(input, pantry)?.Name);
    }
}
