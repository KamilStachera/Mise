using UglyToad.PdfPig;
using UglyToad.PdfPig.DocumentLayoutAnalysis.TextExtractor;

namespace Mise.Api.Services.Import;

/// <summary>Text layer of a PDF, one string per page. Scans (images only) come back as empty pages.</summary>
public static class PdfText
{
    public const int MaxPages = 500;
    public const int MaxTotalChars = 3_000_000;
    private static readonly TimeSpan ExtractTimeout = TimeSpan.FromSeconds(25);
    private static readonly SemaphoreSlim ExtractGate = new(2, 2);

    public static bool LooksLikePdf(byte[] bytes) =>
        bytes.Length > 4 && bytes[0] == '%' && bytes[1] == 'P' && bytes[2] == 'D' && bytes[3] == 'F';

    /// <summary>Throws <see cref="FetchRefusedException"/> (Polish message) for broken, encrypted or huge files.</summary>
    public static List<string> Extract(byte[] bytes, CancellationToken ct = default)
    {
        if (!LooksLikePdf(bytes))
            throw new FetchRefusedException("To nie jest plik PDF.");
        ExtractGate.Wait(ct);
        try
        {
            var deadline = DateTimeOffset.UtcNow + ExtractTimeout;
            using var doc = PdfDocument.Open(bytes);
            if (doc.NumberOfPages > MaxPages)
                throw new FetchRefusedException($"PDF ma {doc.NumberOfPages} stron — limit to {MaxPages}.");
            var pages = new List<string>(doc.NumberOfPages);
            var totalChars = 0;
            foreach (var page in doc.GetPages())
            {
                ct.ThrowIfCancellationRequested();
                if (DateTimeOffset.UtcNow > deadline)
                    throw new FetchRefusedException("Odczyt tego PDF-a trwał zbyt długo (limit 25 s).");
                string text;
                try { text = ContentOrderTextExtractor.GetText(page); }
                catch (Exception) { text = page.Text; }
                var tidied = Tidy(text);
                totalChars += tidied.Length;
                if (totalChars > MaxTotalChars)
                    throw new FetchRefusedException("Ten PDF zawiera zbyt dużo tekstu (limit 3 mln znaków).");
                pages.Add(tidied);
            }
            return pages;
        }
        catch (FetchRefusedException) { throw; }
        catch (OperationCanceledException) { throw; }
        catch (Exception e) when (e.Message.Contains("password", StringComparison.OrdinalIgnoreCase)
                                  || e.Message.Contains("encrypt", StringComparison.OrdinalIgnoreCase))
        {
            throw new FetchRefusedException("PDF jest zabezpieczony hasłem — nie da się go odczytać.");
        }
        catch (Exception)
        {
            throw new FetchRefusedException("Nie udało się odczytać tego PDF-a (uszkodzony albo nietypowy plik).");
        }
        finally
        {
            ExtractGate.Release();
        }
    }

    /// <summary>NFKC turns typesetting ligatures (ﬁ, ﬂ) back into letters; Polish letters are unaffected.</summary>
    private static string Tidy(string text) =>
        string.Join("\n", text.Replace("\r", "").Replace("\0", "").Normalize(System.Text.NormalizationForm.FormKC)
            .Split('\n').Select(l => l.TrimEnd())).Trim();
}
