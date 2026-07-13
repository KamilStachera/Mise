using Mise.Api.Services;

namespace Mise.Api.Features;

public static class ContextEndpoints
{
    public static RouteGroupBuilder MapContext(this RouteGroupBuilder api)
    {
        var g = api.MapGroup("/context").WithTags("Context");

        // Live cookbook.md text for the Profile preview (does not write to disk).
        g.MapGet("/cookbook", async (ContextExportService export) =>
        {
            var md = await export.BuildCookbookAsync();
            return Results.Ok(new { markdown = md });
        });

        g.MapGet("/status", (ContextExportService export) =>
            Results.Ok(new { path = export.Directory, hostPath = export.HostDirectory }));

        // Everything the "Połącz agenta" card needs: copyable prompts/snippets for
        // Codex & Claude Code. When HOST_CONTEXT_DIR is unset the strings contain
        // {{CONTEXT_DIR}} / {{REPO_DIR}} tokens the frontend substitutes client-side.
        g.MapGet("/connect", (ContextExportService export, IConfiguration config) =>
        {
            var ctxDir = export.HostDirectory ?? AgentDocs.ContextDirToken;
            var repoDir = export.HostDirectory is string host
                ? (System.IO.Path.GetDirectoryName(host.TrimEnd('\\', '/')) ?? AgentDocs.RepoDirToken)
                : AgentDocs.RepoDirToken;
            // This endpoint is privileged (see ApiAccessMiddleware), so the real key
            // may be rendered into the copyable MCP snippets when configured.
            var apiKey = config["MISE_API_KEY"] is string k && !string.IsNullOrWhiteSpace(k) ? k : null;
            return Results.Ok(new
            {
                apiBase = export.ApiBase,
                contextPath = export.Directory,
                hostContextPath = export.HostDirectory,
                prompts = new
                {
                    oneShot = AgentDocs.OneShotPrompt(ctxDir, export.ApiBase),
                    globalSnippet = AgentDocs.GlobalSnippet(ctxDir, export.ApiBase),
                    commandsInstall = AgentDocs.CommandsInstall(ctxDir),
                    claudeMcpCommand = AgentDocs.ClaudeMcpCommand(repoDir, apiKey),
                    codexMcpToml = AgentDocs.CodexMcpToml(repoDir, apiKey),
                },
            });
        });

        // The "Sync" / "Open in editor" action — regenerate the whole context folder.
        g.MapPost("/export", async (ContextExportService export) =>
        {
            var result = await export.ExportAsync();
            return Results.Ok(new { path = result.Path, files = result.Files, exportedAt = result.ExportedAt });
        });

        return api;
    }
}
