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
}
