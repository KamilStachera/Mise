using Mise.Api.Services.Import;

namespace Mise.Api.Features;

public record ImportUrlRequest(string Url);

/// <summary>
/// Read-only import helpers for agents (Sous, MCP, personal keys): fetch a recipe page or PDF
/// by URL, upload a PDF, read a stored PDF a few pages at a time. They never create recipes —
/// the agent saves through POST /recipes after the user agrees. Private even for reads
/// (ApiAccessMiddleware), and POSTs need a member anyway.
/// </summary>
public static class ImportEndpoints
{
    public const long MaxUploadBytes = SafeWebFetcher.MaxBytes;

    public static RouteGroupBuilder MapImport(this RouteGroupBuilder api)
    {
        var g = api.MapGroup("/import").WithTags("Import");

        g.MapPost("/url", async (ImportUrlRequest req, ImportService import, CancellationToken ct) =>
        {
            try { return Results.Ok(await import.ReadUrlAsync(req.Url, ct)); }
            catch (FetchRefusedException e) { return Refused(e); }
        });

        g.MapPost("/documents", async (IFormFile file, ImportService import, CancellationToken ct) =>
        {
            if (file.Length is 0 or > MaxUploadBytes)
                return Results.BadRequest(new { error = "PDF musi mieć od 1 B do 20 MB." });
            using var buffer = new MemoryStream();
            await file.CopyToAsync(buffer, ct);
            try { return Results.Ok(await import.SaveDocumentAsync(Path.GetFileName(file.FileName), null, buffer.ToArray(), ct)); }
            catch (FetchRefusedException e) { return Refused(e); }
        }).DisableAntiforgery();

        g.MapGet("/documents/{id:guid}", async (Guid id, int? fromPage, int? toPage, ImportService import, CancellationToken ct) =>
            await import.SliceAsync(id, fromPage ?? 1, toPage, ct) is { } slice
                ? Results.Ok(slice)
                : Results.NotFound(new { error = $"Nie ma takiego dokumentu (importy znikają po {Domain.ImportDocument.RetentionDays} dniach)." }));

        return api;
    }

    private static IResult Refused(FetchRefusedException e) =>
        Results.UnprocessableEntity(new { error = e.Message });
}
