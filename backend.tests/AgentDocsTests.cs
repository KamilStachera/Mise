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
}
