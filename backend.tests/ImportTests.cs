using System.Net;
using System.Net.Http.Json;
using System.Text;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Mise.Api.Data;
using Mise.Api.Domain;
using Mise.Api.Features;
using Mise.Api.Services;
using Mise.Api.Services.Import;
using UglyToad.PdfPig.Fonts.Standard14Fonts;
using UglyToad.PdfPig.Writer;
using Xunit;

namespace Mise.Api.Tests;

/// <summary>Recipe import sources: JSON-LD pages, page text, PDFs, and the fetcher's LAN guard.</summary>
public class ImportTests
{
    private static readonly Uri Base = new("https://example.pl/przepisy/szakszuka");

    // ---- page parsing ----

    [Fact]
    public void JsonLdRecipe_InGraph_WithSectionsImagesDurationsAndNutrition()
    {
        const string html = """
            <html><head><title>Szakszuka | Example</title>
            <meta property="og:image" content="/img/og.jpg">
            <script type="application/ld+json">{ broken json </script>
            <script type='application/ld+json'>
            {"@context":"https://schema.org","@graph":[
              {"@type":"WebPage","name":"Szakszuka"},
              {"@type":["Recipe","NewsArticle"],"name":"Szakszuka &amp; feta",
               "author":[{"@type":"Person","name":"Ola"}],
               "recipeYield":["2","2 porcje"],
               "prepTime":"PT10M","cookTime":"PT1H5M","totalTime":"P0DT1H15M",
               "image":[{"@type":"ImageObject","url":"https://cdn.example.pl/s.jpg"},{"url":"https://cdn.example.pl/l.jpg"}],
               "recipeIngredient":["4 jajka","400 g pomidorów <b>z puszki</b>"],
               "recipeInstructions":[
                 {"@type":"HowToSection","name":"Sos","itemListElement":[
                   {"@type":"HowToStep","text":"Podsmaż cebulę 5 minut."},
                   {"@type":"HowToStep","text":"Dodaj pomidory."}]},
                 {"@type":"HowToStep","name":"Wbij jajka i duś 8 minut."}],
               "nutrition":{"@type":"NutritionInformation","calories":"320 kcal","proteinContent":"18 g"},
               "recipeCuisine":"bliskowschodnia","recipeCategory":["Śniadanie","Jajka"]}
            ]}
            </script></head><body>tekst strony</body></html>
            """;

        var page = RecipePageParser.Parse(html, Base);

        var r = Assert.Single(page.Recipes);
        Assert.Equal("Szakszuka & feta", r.Name);
        Assert.Equal("Ola", r.Author);
        Assert.Equal("2 porcje", r.Yield);
        Assert.Equal((10, 65, 75), (r.PrepMinutes, r.CookMinutes, r.TotalMinutes));
        Assert.Equal("https://cdn.example.pl/l.jpg", r.ImageUrl);
        Assert.Equal(["4 jajka", "400 g pomidorów z puszki"], r.Ingredients);
        Assert.Equal(["[Sos]", "Podsmaż cebulę 5 minut.", "Dodaj pomidory.", "Wbij jajka i duś 8 minut."], r.Steps);
        Assert.Equal("320 kcal", r.Nutrition?.Calories);
        Assert.Equal("18 g", r.Nutrition?.Protein);
        Assert.Equal("Śniadanie, Jajka", r.Category);
        Assert.Equal("https://example.pl/img/og.jpg", page.ImageUrl);
        Assert.Null(page.Text); // structured data found — no need for page text
    }

    [Fact]
    public void JsonLdInstructions_AsOneHtmlString_SplitIntoSteps()
    {
        const string html = """
            <script type="application/ld+json">{"@type":"Recipe","name":"Placki",
              "recipeInstructions":"<p>Wymieszaj składniki.</p><p>Smaż 2 minuty z każdej strony.</p>"}</script>
            """;
        var r = Assert.Single(RecipePageParser.Parse(html, Base).Recipes);
        Assert.Equal(["Wymieszaj składniki.", "Smaż 2 minuty z każdej strony."], r.Steps);
    }

    [Fact]
    public void Microdata_Recipe_AsPublishedByAniagotuje()
    {
        const string html = """
            <div itemscope itemtype="https://schema.org/Recipe">
              <h1 itemprop="name">Pierogi ruskie</h1>
              <img itemprop="image" src="/img/pierogi.jpg">
              <meta itemprop="prepTime" content="PT1H">
              <span itemprop="recipeYield">około 60 pierogów</span>
              <div itemprop="author" itemscope itemtype="https://schema.org/Person"><span itemprop="name">Ania</span></div>
              <ul><li itemprop="recipeIngredient">500 g mąki</li><li itemprop="recipeIngredient">250 ml&nbsp;wody</li></ul>
              <div itemprop="nutrition" itemscope itemtype="https://schema.org/NutritionInformation">
                <span itemprop="calories">148 kcal</span></div>
              <div itemprop="recipeInstructions" itemscope itemtype="https://schema.org/HowToStep">
                <h3 itemprop="name">Przygotuj ziemniaki</h3><p itemprop="text">Ugotuj ziemniaki 20 minut.</p></div>
              <div itemprop="recipeInstructions" itemscope itemtype="https://schema.org/HowToStep">
                <p itemprop="text">Zagnieć ciasto 10 minut.</p></div>
            </div>
            """;
        var r = Assert.Single(RecipePageParser.Parse(html, Base).Recipes);
        Assert.Equal("Pierogi ruskie", r.Name);
        Assert.Equal("https://example.pl/img/pierogi.jpg", r.ImageUrl);
        Assert.Equal(60, r.PrepMinutes);
        Assert.Equal("około 60 pierogów", r.Yield);
        Assert.Equal("Ania", r.Author);
        Assert.Equal(["500 g mąki", "250 ml wody"], r.Ingredients);
        Assert.Equal(["Przygotuj ziemniaki: Ugotuj ziemniaki 20 minut.", "Zagnieć ciasto 10 minut."], r.Steps);
        Assert.Equal("148 kcal", r.Nutrition?.Calories);
    }

    [Fact]
    public void StubStructuredData_StillSendsThePageText()
    {
        const string html = """
            <script type="application/ld+json">{"@type":"Recipe","name":"Szarlotka","image":"https://x.pl/s.jpg"}</script>
            <main><p>1 kg jabłek</p><p>Piecz 50 minut w 180°C.</p></main>
            """;
        var page = RecipePageParser.Parse(html, Base);
        Assert.Equal("Szarlotka", Assert.Single(page.Recipes).Name);
        Assert.Equal("1 kg jabłek\nPiecz 50 minut w 180°C.", page.Text);
    }

    [Theory]
    [InlineData("Sos", "Podsmaż cebulę.", "Sos: Podsmaż cebulę.")]
    [InlineData("Podsmaż cebulę…", "Podsmaż cebulę 5 minut.", "Podsmaż cebulę 5 minut.")]
    [InlineData(null, "Dodaj pomidory.", "Dodaj pomidory.")]
    [InlineData("Wbij jajka.", null, "Wbij jajka.")]
    public void JoinStep_MergesHeadingAndText_WithoutRepeating(string? name, string? text, string expected) =>
        Assert.Equal(expected, RecipePageParser.JoinStep(name, text));

    [Fact]
    public void PageWithoutStructuredData_FallsBackToVisibleMainText()
    {
        const string html = """
            <html><head><title>Babcine pierogi</title><style>.x{}</style></head><body>
            <nav>Menu Kontakt</nav>
            <main><h1>Pierogi</h1><script>track()</script><ul><li>500 g mąki</li><li>250 ml wody</li></ul>
            <p>Zagnieć ciasto&nbsp;10 minut.</p></main>
            <footer>© 2026</footer></body></html>
            """;
        var page = RecipePageParser.Parse(html, Base);
        Assert.Empty(page.Recipes);
        Assert.Equal("Babcine pierogi", page.Title);
        Assert.Equal("Pierogi\n500 g mąki\n250 ml wody\nZagnieć ciasto 10 minut.", page.Text);
        Assert.False(page.TextTruncated);
    }

    [Fact]
    public void Decode_HonoursMetaCharset_ForOldPolishSites()
    {
        var bytes = CodePages().GetBytes("<meta charset=\"windows-1250\"><p>Żurek z kiełbasą</p>");
        Assert.Contains("Żurek z kiełbasą", RecipePageParser.Decode(bytes, null));
        Assert.Contains("Żurek", RecipePageParser.Decode(Encoding.UTF8.GetBytes("<p>Żurek</p>"), "utf-8"));

        static Encoding CodePages()
        {
            Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
            return Encoding.GetEncoding(1250);
        }
    }

    // ---- fetch guard ----

    [Theory]
    [InlineData("8.8.8.8", true)]
    [InlineData("151.101.1.1", true)]
    [InlineData("2606:4700::1111", true)]
    [InlineData("127.0.0.1", false)]
    [InlineData("10.0.0.5", false)]
    [InlineData("172.18.0.3", false)]     // docker network
    [InlineData("192.168.1.26", false)]   // the home server itself
    [InlineData("169.254.169.254", false)]
    [InlineData("100.64.0.1", false)]
    [InlineData("0.0.0.0", false)]
    [InlineData("::1", false)]
    [InlineData("fd00::1", false)]
    [InlineData("fe80::1", false)]
    [InlineData("::ffff:192.168.1.1", false)]
    public void IsPublic_RefusesEverythingButGlobalUnicast(string ip, bool expected) =>
        Assert.Equal(expected, SafeWebFetcher.IsPublic(IPAddress.Parse(ip)));

    [Theory]
    [InlineData("ftp://example.pl/a.pdf")]
    [InlineData("http://localhost/x")]
    [InlineData("http://sous:8090/health")]
    [InlineData("http://192.168.1.1/")]
    [InlineData("https://example.pl:8443/")]
    [InlineData("https://user:pass@example.pl/")]
    [InlineData("nie-adres")]
    public void ValidateUrl_RefusesNonPublicOrOddUrls(string url) =>
        Assert.Throws<FetchRefusedException>(() => SafeWebFetcher.ValidateUrl(url));

    [Fact]
    public void ValidateUrl_AcceptsOrdinaryRecipeLinks() =>
        Assert.Equal("www.kwestiasmaku.com", SafeWebFetcher.ValidateUrl("https://www.kwestiasmaku.com/przepis/szakszuka").Host);

    // ---- PDFs ----

    [Fact]
    public void PdfText_ReadsEachPage_AndRefusesNonPdf()
    {
        var pages = PdfText.Extract(Pdf("Szakszuka 4 jajka", "Pierogi 500 g maki"));
        Assert.Equal(2, pages.Count);
        Assert.Contains("Szakszuka", pages[0]);
        Assert.Contains("Pierogi", pages[1]);
        Assert.Throws<FetchRefusedException>(() => PdfText.Extract("<html>"u8.ToArray()));
    }

    [Fact]
    public async Task Documents_AreSlicedByCharacterBudget_AndPrivateToTheirHousehold()
    {
        var name = Guid.NewGuid().ToString();
        await SeedHouseholdsAsync(name);
        var longPage = new string('a', ImportService.MaxSliceChars / 2 + 10);
        Guid id;
        await using (var db = Db(name, TenantContext.For(1)))
        {
            var import = new ImportService(db, new SafeWebFetcher());
            var info = await import.SaveDocumentAsync("ksiazka.pdf", null, Pdf("Strona jeden"), CancellationToken.None);
            id = info.Id;
            // Swap in big pages to exercise the budget (the writer's text is short).
            var doc = await db.ImportDocuments.SingleAsync();
            doc.Pages = [longPage, longPage, "trzecia"];
            await db.SaveChangesAsync();

            var first = await import.SliceAsync(id, 1, null, CancellationToken.None);
            Assert.Equal((1, 1, 2), (first!.FromPage, first.ToPage, first.NextPage));
            var rest = await import.SliceAsync(id, 2, null, CancellationToken.None);
            Assert.Equal((2, 3, (int?)null), (rest!.FromPage, rest.ToPage, rest.NextPage));
            Assert.Equal("trzecia", rest.Pages[^1].Text);
            Assert.Equal("ksiazka.pdf", (await import.InfoAsync(id, CancellationToken.None))!.Name);
        }

        await using (var other = Db(name, TenantContext.For(2)))
            Assert.Null(await new ImportService(other, new SafeWebFetcher()).SliceAsync(id, 1, null, CancellationToken.None));
    }

    [Fact]
    public async Task SavingADocument_DropsStaleImports()
    {
        var name = Guid.NewGuid().ToString();
        await SeedHouseholdsAsync(name);
        await using var db = Db(name, TenantContext.For(1));
        db.ImportDocuments.Add(new ImportDocument
        {
            Name = "stary.pdf", Pages = ["x"],
            CreatedAt = DateTimeOffset.UtcNow.AddDays(-ImportDocument.RetentionDays - 1),
        });
        await db.SaveChangesAsync();

        await new ImportService(db, new SafeWebFetcher()).SaveDocumentAsync("nowy.pdf", null, Pdf("x"), CancellationToken.None);

        Assert.Equal(["nowy.pdf"], await db.ImportDocuments.Select(d => d.Name).ToListAsync());
    }

    [Fact]
    public async Task ImportRoutes_ArePrivate_EvenWithAPublicHousehold()
    {
        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseTestServer();
        builder.Configuration["PUBLIC_HOUSEHOLD_ID"] = "1";
        var dbName = Guid.NewGuid().ToString();
        builder.Services.AddDbContext<MiseDbContext>(o => o.UseInMemoryDatabase(dbName));
        builder.Services.AddSingleton<AccessControl>();
        builder.Services.AddTenancy();
        builder.Services.AddSingleton<SafeWebFetcher>();
        builder.Services.AddScoped<ImportService>();
        await using var app = builder.Build();
        app.UseMiddleware<ApiAccessMiddleware>();
        app.MapGroup("/api").MapImport();
        await app.StartAsync();
        using var client = app.GetTestClient();

        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync($"/api/import/documents/{Guid.NewGuid()}")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized,
            (await client.PostAsJsonAsync("/api/import/url", new { url = "https://example.pl" })).StatusCode);
    }

    private static byte[] Pdf(params string[] pageTexts)
    {
        var builder = new PdfDocumentBuilder();
        var font = builder.AddStandard14Font(Standard14Font.Helvetica);
        foreach (var text in pageTexts)
            builder.AddPage(UglyToad.PdfPig.Content.PageSize.A4).AddText(text, 12, new UglyToad.PdfPig.Core.PdfPoint(50, 700), font);
        return builder.Build();
    }

    private static MiseDbContext Db(string name, TenantContext tenant) =>
        new(new DbContextOptionsBuilder<MiseDbContext>().UseInMemoryDatabase(name).Options, tenant);

    private static async Task SeedHouseholdsAsync(string name)
    {
        await using var db = Db(name, TenantContext.System());
        db.Households.AddRange(new Household { Id = 1, Name = "Dom" }, new Household { Id = 2, Name = "Znajomi" });
        await db.SaveChangesAsync();
    }
}
