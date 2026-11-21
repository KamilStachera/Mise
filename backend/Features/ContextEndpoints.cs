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

        g.MapGet("/status", (ContextExportService export, Caller caller) =>
            Results.Ok(new
            {
                path = caller.IsAdmin ? export.Directory : null,
                hostPath = caller.IsAdmin ? export.HostDirectory : null,
            }));

        // Everything the "Połącz agenta" card needs: copyable prompts/snippets for
        // Codex & Claude Code. Host filesystem paths are only exposed to instance admins
        // so non-admin households receive portable {{CONTEXT_DIR}} / {{REPO_DIR}} tokens.
        g.MapGet("/connect", (ContextExportService export, Caller caller) =>
        {
            var hostDir = caller.IsAdmin ? export.HostDirectory : null;
            var hostRoot = caller.IsAdmin ? export.HostRoot : null;
            var ctxDir = hostDir ?? AgentDocs.ContextDirToken;
            // HOST_CONTEXT_DIR is the repo's context folder; this household's export is a subfolder of it.
            var repoDir = hostRoot is string host
                ? (System.IO.Path.GetDirectoryName(host) ?? AgentDocs.RepoDirToken)
                : AgentDocs.RepoDirToken;
            return Results.Ok(new
            {
                apiBase = export.ApiBase,
                contextPath = caller.IsAdmin ? export.Directory : null,
                hostContextPath = hostDir,
                prompts = new
                {
                    oneShot = AgentDocs.OneShotPrompt(ctxDir, export.ApiBase),
                    globalSnippet = AgentDocs.GlobalSnippet(ctxDir, export.ApiBase),
                    commandsInstall = AgentDocs.CommandsInstall(ctxDir),
                    claudeMcpCommand = AgentDocs.ClaudeMcpCommand(repoDir),
                    codexMcpToml = AgentDocs.CodexMcpToml(repoDir),
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
