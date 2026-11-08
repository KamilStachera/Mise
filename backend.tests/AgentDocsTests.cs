using Mise.Api.Services;
using Xunit;

namespace Mise.Api.Tests;

public class AgentDocsTests
{
    [Fact]
    public void BrowserVisibleMcpSnippets_DoNotReferenceApiKey()
    {
        var claude = AgentDocs.ClaudeMcpCommand("C:/repo");
        var codex = AgentDocs.CodexMcpToml("C:/repo");

        Assert.DoesNotContain("MISE_API_KEY", claude, StringComparison.Ordinal);
        Assert.DoesNotContain("MISE_API_KEY", codex, StringComparison.Ordinal);
        Assert.DoesNotContain("X-Api-Key", claude, StringComparison.Ordinal);
        Assert.DoesNotContain("X-Api-Key", codex, StringComparison.Ordinal);
        Assert.Contains("C:/repo/mcp/dist/index.js", claude, StringComparison.Ordinal);
        Assert.Contains("C:/repo/mcp/dist/index.js", codex, StringComparison.Ordinal);
    }

    [Fact]
    public void RecipeGuidelines_RequireConcreteQuantitiesAndCookingTimes()
    {
        var agents = AgentDocs.AgentsMd("http://localhost:5080/api");
        var api = AgentDocs.ApiMd("http://localhost:5080/api");

        Assert.Contains("Precyzja jest obowiązkowa", agents, StringComparison.Ordinal);
        Assert.Contains("sól `2 g`, pieprz `0,5 g`", agents, StringComparison.Ordinal);
        Assert.Contains("8 minut, do 74°C w środku", agents, StringComparison.Ordinal);
        Assert.Contains("Precyzja przepisu jest obowiązkowa", api, StringComparison.Ordinal);
        Assert.Contains("Nie odsyłaj do opakowania", api, StringComparison.Ordinal);
        Assert.Contains("temperatura 74°C w środku", api, StringComparison.Ordinal);
    }

    [Fact]
    public void SuppliesDocs_StateTheDecouplingAndTheHotRanking()
    {
        var agents = AgentDocs.AgentsMd("http://localhost:5080/api");
        var api = AgentDocs.ApiMd("http://localhost:5080/api");

        Assert.Contains("`supplies.md`", agents, StringComparison.Ordinal);
        Assert.Contains("POST http://localhost:5080/api/supplies", agents, StringComparison.Ordinal);
        Assert.Contains("## Dom i chemia", api, StringComparison.Ordinal);
        Assert.Contains("niezależna od spiżarni **i od listy zakupów spożywczych**", api,
            StringComparison.Ordinal);
        Assert.Contains("GET /supplies/hot", api, StringComparison.Ordinal);
    }

    [Fact]
    public void TrainingDocs_ForbidGuessedVideosAndShipTheEnrichCommand()
    {
        var agents = AgentDocs.AgentsMd("http://localhost:5080/api");
        var api = AgentDocs.ApiMd("http://localhost:5080/api");
        var commands = AgentDocs.CommandFiles("http://localhost:5080/api", "/ctx");

        Assert.Contains("## Trening — katalog ćwiczeń", agents, StringComparison.Ordinal);
        Assert.Contains("Nigdy nie zgaduj id", agents, StringComparison.Ordinal);
        Assert.Contains("`enrich_exercises`", agents, StringComparison.Ordinal);
        Assert.Contains("## Ćwiczenia (katalog treningowy, wspólny)", api, StringComparison.Ordinal);
        Assert.Contains("POST /exercises/enrich", api, StringComparison.Ordinal);
        Assert.Contains("middle-back", api, StringComparison.Ordinal);
        Assert.True(commands.ContainsKey("wzbogac-cwiczenia.md"));
        Assert.Contains("Nie zgaduj id", commands["wzbogac-cwiczenia.md"], StringComparison.Ordinal);
        Assert.Contains("/wzbogac-cwiczenia", AgentDocs.CommandsInstall("/ctx"), StringComparison.Ordinal);
    }

    [Fact]
    public void TrainingPlanDocs_DescribeTheGridPrivacyAndTheCommand()
    {
        var agents = AgentDocs.AgentsMd("http://localhost:5080/api");
        var api = AgentDocs.ApiMd("http://localhost:5080/api");
        var commands = AgentDocs.CommandFiles("http://localhost:5080/api", "/ctx");

        Assert.Contains("## Trening — ankieta i plan (prywatne, per osoba)", agents, StringComparison.Ordinal);
        Assert.Contains("`create_training_program`", agents, StringComparison.Ordinal);
        Assert.Contains("`/training/*`", api, StringComparison.Ordinal);
        Assert.Contains("POST /training/programs", api, StringComparison.Ordinal);
        Assert.Contains("0 = poniedziałek", api, StringComparison.Ordinal);
        Assert.True(commands.ContainsKey("plan-treningowy.md"));
        Assert.Contains("Poczekaj na moją zgodę", commands["plan-treningowy.md"], StringComparison.Ordinal);
        Assert.Contains("/plan-treningowy", AgentDocs.CommandsInstall("/ctx"), StringComparison.Ordinal);
        var sous = AgentDocs.SousInstructions("Ola");
        Assert.Contains("dopisuje sama w tle", sous, StringComparison.Ordinal);
        Assert.Contains("nigdy nie zgaduj", sous, StringComparison.Ordinal);
        Assert.DoesNotContain("nie masz wyszukiwarki", sous, StringComparison.Ordinal);
        Assert.Contains("Aplikacja sama uzupełnia opisy i filmy w tle", agents, StringComparison.Ordinal);
    }
}
