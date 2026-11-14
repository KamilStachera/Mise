using Microsoft.EntityFrameworkCore;
using Mise.Api.Data;
using Mise.Api.Domain;

namespace Mise.Api.Services.Import;

public sealed record DocumentPage(int Page, string Text);

/// <param name="LooksScanned">Almost no text layer — probably a scan; the agent should ask for photos instead.</param>
public sealed record DocumentInfo(Guid Id, string Name, int PageCount, int TextChars, bool LooksScanned);

/// <param name="NextPage">Where to continue reading; null when this slice reached the end.</param>
public sealed record DocumentSlice(Guid Id, string Name, int PageCount, int FromPage, int ToPage,
    IReadOnlyList<DocumentPage> Pages, int? NextPage, bool LooksScanned);

/// <param name="Kind">"page" (HTML: recipes from JSON-LD, else text) or "pdf" (stored as a document, first slice inline).</param>
public sealed record UrlImportResult(string Kind, string Url, string? Title, string? ImageUrl,
    IReadOnlyList<ImportedRecipe> Recipes, string? Text, bool TextTruncated, DocumentSlice? Document);

/// <summary>
/// Reads import sources for agents: a recipe page or PDF by URL, or an uploaded PDF. Nothing
/// here writes recipes — the agent normalizes what it read and saves it through POST /recipes
/// after the user agrees, like any other recipe.
/// </summary>
public sealed class ImportService(MiseDbContext db, SafeWebFetcher fetcher)
{
    /// <summary>Per slice, so a 200-page cookbook arrives a chapter at a time.</summary>
    public const int MaxSliceChars = 40_000;

    public async Task<UrlImportResult> ReadUrlAsync(string url, CancellationToken ct)
    {
        var res = await fetcher.FetchAsync(url, ct);
        var finalUrl = res.FinalUrl.ToString();

        if (res.MediaType == "application/pdf" || PdfText.LooksLikePdf(res.Bytes))
        {
            var name = Uri.UnescapeDataString(res.FinalUrl.Segments.LastOrDefault() ?? "").Trim('/');
            var info = await SaveDocumentAsync(string.IsNullOrWhiteSpace(name) ? res.FinalUrl.Host + ".pdf" : name, finalUrl, res.Bytes, ct);
            var slice = await SliceAsync(info.Id, 1, null, ct);
            return new UrlImportResult("pdf", finalUrl, info.Name, null, [], null, false, slice);
        }

        if (res.MediaType is not null && !res.MediaType.Contains("html") && !res.MediaType.StartsWith("text/"))
            throw new FetchRefusedException(
                $"Pod tym adresem jest plik typu {res.MediaType}, a nie strona z przepisem ani PDF.");

        var page = RecipePageParser.Parse(RecipePageParser.Decode(res.Bytes, res.Charset), res.FinalUrl);
        return new UrlImportResult("page", finalUrl, page.Title, page.ImageUrl, page.Recipes, page.Text, page.TextTruncated, null);
    }

    public async Task<DocumentInfo> SaveDocumentAsync(string name, string? sourceUrl, byte[] bytes, CancellationToken ct)
    {
        var pages = PdfText.Extract(bytes);
        if (pages.Count == 0) throw new FetchRefusedException("Ten PDF nie ma żadnych stron.");

        // Scratch data — drop this household's stale imports while we're here.
        var cutoff = DateTimeOffset.UtcNow.AddDays(-ImportDocument.RetentionDays);
        db.ImportDocuments.RemoveRange(await db.ImportDocuments.Where(d => d.CreatedAt < cutoff).ToListAsync(ct));

        var doc = new ImportDocument
        {
            Name = name.Length > 300 ? name[..300] : name,
            SourceUrl = sourceUrl is { Length: > 2000 } ? sourceUrl[..2000] : sourceUrl,
            Pages = pages,
        };
        db.ImportDocuments.Add(doc);
        await db.SaveChangesAsync(ct);
        return InfoOf(doc);
    }

    public async Task<DocumentInfo?> InfoAsync(Guid id, CancellationToken ct) =>
        await db.ImportDocuments.AsNoTracking().FirstOrDefaultAsync(d => d.Id == id, ct) is { } doc ? InfoOf(doc) : null;

    /// <summary>Pages <paramref name="from"/>..<paramref name="to"/> (1-based), cut at <see cref="MaxSliceChars"/> but never empty.</summary>
    public async Task<DocumentSlice?> SliceAsync(Guid id, int from, int? to, CancellationToken ct)
    {
        var doc = await db.ImportDocuments.AsNoTracking().FirstOrDefaultAsync(d => d.Id == id, ct);
        if (doc is null) return null;
        var count = doc.Pages.Count;
        from = Math.Clamp(from, 1, Math.Max(count, 1));
        var last = Math.Clamp(to ?? count, from, count);

        var pages = new List<DocumentPage>();
        var chars = 0;
        for (var p = from; p <= last; p++)
        {
            var text = doc.Pages[p - 1];
            if (pages.Count > 0 && chars + text.Length > MaxSliceChars) break;
            pages.Add(new DocumentPage(p, text.Length > MaxSliceChars ? text[..MaxSliceChars] : text));
            chars += text.Length;
        }
        var end = pages.Count == 0 ? from : pages[^1].Page;
        return new DocumentSlice(doc.Id, doc.Name, count, from, end, pages, end < count ? end + 1 : null, InfoOf(doc).LooksScanned);
    }

    private static DocumentInfo InfoOf(ImportDocument doc)
    {
        var chars = doc.Pages.Sum(p => p.Length);
        return new DocumentInfo(doc.Id, doc.Name, doc.Pages.Count, chars, chars < 40 * doc.Pages.Count);
    }
}
