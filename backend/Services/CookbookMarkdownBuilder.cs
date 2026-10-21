using System.Text;
using Mise.Api.Domain;

namespace Mise.Api.Services;

/// <summary>
/// Renders the "Cooking Profile" into the cookbook.md memory file that is fed to
/// the AI at the start of every chat (and exported for Codex / Claude Code).
/// Mirrors the dark preview shown on the Profile screen of the design (in Polish).
/// </summary>
public sealed class CookbookMarkdownBuilder
{
    public string Build(Preferences prefs, IReadOnlyList<PantryItem> pantry, IReadOnlyList<Recipe> recipes,
        IReadOnlyDictionary<string, string> answers)
    {
        var sb = new StringBuilder();
        sb.AppendLine("# Pamięć kulinarna — Pichci");
        sb.AppendLine();

        sb.AppendLine("## Gospodarstwo");
        sb.AppendLine($"- {Join(prefs.HouseholdSummary, prefs.HouseholdDetail)}");
        sb.AppendLine();

        sb.AppendLine("## Sprzęt");
        if (prefs.Equipment.Count > 0)
        {
            var parts = prefs.Equipment
                .OrderByDescending(e => e.Favorite)
                .ThenBy(e => e.Order)
                .Select(e => e.Favorite ? $"★ {e.Name} (ulubiony)" : e.Name);
            sb.AppendLine($"- {string.Join(", ", parts)}.");
        }
        if (!string.IsNullOrWhiteSpace(prefs.EquipmentNote))
            sb.AppendLine($"- {prefs.EquipmentNote}");
        sb.AppendLine();

        sb.AppendLine("## Umiejętności i czas");
        sb.AppendLine($"- {Join(prefs.SkillSummary, prefs.SkillDetail)}");
        sb.AppendLine();

        sb.AppendLine("## Smaki");
        foreach (var line in SplitLines(prefs.TasteCuisines))
            sb.AppendLine($"- {line}");
        sb.AppendLine();

        if (!string.IsNullOrWhiteSpace(prefs.AvoidDietary))
        {
            sb.AppendLine("## Unikać / dieta");
            foreach (var line in SplitLines(prefs.AvoidDietary))
                sb.AppendLine($"- {line}");
            sb.AppendLine();
        }

        AppendQuestionnaire(sb, answers);

        var servings = answers.GetValueOrDefault("assistant.servings", "2");
        var airfryer = answers.GetValueOrDefault("assistant.airfryer", "gdy ma sens");
        sb.AppendLine("## Zasady dla asystenta");
        sb.AppendLine("- Sprawdź `pantry.json` przed propozycją — zaznacz wszystko, co trzeba dokupić.");
        sb.AppendLine("- Ilości w spiżarni są przybliżone (g/ml/szt); do zakupów używaj `iloscDoPlanowania`. Po zakupach dodawaj delty przez " +
            "`POST /pantry/adjust`; nowe pozycje katalogu tylko świadomie przez `POST /pantry`.");
        sb.AppendLine($"- Gotując dla domu, domyślnie {servings} porcje. Kcal i makro przepisu są zawsze na jedną porcję (jedna osoba). " +
            $"Frytkownica beztłuszczowa: {airfryer}.");
        sb.AppendLine("- Zapisy (przepisy, spiżarnia, plan, dziennik, historia) wyłącznie narzędziami MCP `pichci` albo przez REST API — " +
            "patrz `AGENTS.md` i `api.md`. Nie edytuj plików w tym folderze.");
        sb.AppendLine("- Plan tygodnia jest w `plan.md`, historia gotowania w `cooklog.md`. Dziennik jedzenia, cel i waga są prywatne " +
            "(tylko przez narzędzia/API).");
        sb.AppendLine();

        sb.AppendLine($"## Stan spiżarni ({pantry.Count} pozycji w katalogu)");
        var byStatus = pantry.ToLookup(Features.Mapping.StatusOf);
        var low = byStatus[PantryStatus.Low].Select(p => $"{p.Name} ({QuantityLabel(p)})").ToList();
        var outOf = byStatus[PantryStatus.Out].Select(p => p.Name).ToList();
        sb.AppendLine($"- Na stanie: {byStatus[PantryStatus.In].Count()} pozycji (szacunki i pewne ilości do planowania w `pantry.json`).");
        if (low.Count > 0) sb.AppendLine($"- Kończy się: {string.Join(", ", low)}.");
        if (outOf.Count > 0) sb.AppendLine($"- Brak: {string.Join(", ", outOf)}.");
        sb.AppendLine();

        sb.AppendLine($"## Zapisane przepisy ({recipes.Count})");
        // Exact spellings, so agents reuse them and the library's "Źródło" filter stays grouped.
        var origins = recipes.Where(r => r.SourceName is not null)
            .GroupBy(r => r.SourceName!, StringComparer.OrdinalIgnoreCase)
            .OrderByDescending(g => g.Count()).ThenBy(g => g.Key, Pl.Comparer)
            .Select(g => $"„{g.Key}” ({g.Count()})")
            .ToList();
        if (origins.Count > 0)
            sb.AppendLine($"Źródła (`sourceName`): {string.Join(", ", origins)}.");
        foreach (var r in recipes.OrderBy(r => r.Title, Pl.Comparer))
        {
            var meta = new List<string> { $"{r.TimeMinutes} min", ServingsLabel(r.Servings) };
            if (r.DishType is DishType d) meta.Add(DishTypeLabel(d).ToLowerInvariant());
            if (r.Cuisine is Cuisine c) meta.Add($"kuchnia {CuisineLabel(c)}");
            if (AirFryer.Uses(r)) meta.Add("frytkownica");
            if (r.KcalPerServing is int kcal) meta.Add($"~{kcal} kcal/porcja");
            sb.AppendLine($"- {r.Title} — {string.Join(", ", meta)} ({SourceLabel(r.Source)}{(r.SourceName is { } sn ? $": {sn}" : "")}). Zobacz `recipes/`.");
        }

        return sb.ToString().TrimEnd() + "\n";
    }

    /// <summary>Questionnaire answers, grouped by section; unanswered questions are skipped.</summary>
    private static void AppendQuestionnaire(StringBuilder sb, IReadOnlyDictionary<string, string> answers)
    {
        if (answers.Count == 0) return;

        var wroteHeader = false;
        foreach (var section in ProfileQuestionnaire.Sections)
        {
            var answered = section.Questions
                .Select(q => (q.Label, Value: answers.GetValueOrDefault(q.Key, "")))
                .Where(x => x.Value.Length > 0)
                .ToList();
            if (answered.Count == 0) continue;

            if (!wroteHeader)
            {
                sb.AppendLine("## Profil szczegółowy (ankieta)");
                wroteHeader = true;
            }
            sb.AppendLine($"### {section.Title}");
            foreach (var (label, value) in answered)
                sb.AppendLine($"- {label}: {value}");
        }
        if (wroteHeader) sb.AppendLine();
    }

    private static string Join(string a, string b) =>
        string.IsNullOrWhiteSpace(b) ? a : string.IsNullOrWhiteSpace(a) ? b : $"{a}. {b}";

    private static IEnumerable<string> SplitLines(string text) =>
        (text ?? "").Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

    /// <summary>„1 porcja”, „2 porcje”, „5 porcji” (nominative, for recipe meta lines).</summary>
    public static string ServingsLabel(int n) =>
        n == 1 ? "1 porcja"
        : n % 10 is >= 2 and <= 4 && n % 100 is < 12 or > 14 ? $"{n} porcje"
        : $"{n} porcji";

    public static string SourceLabel(RecipeSource s) => s switch
    {
        RecipeSource.Ai => "od AI",
        RecipeSource.Web => "sieć/książka",
        _ => "moje własne",
    };

    // Polish labels mirror frontend/src/lib/labels.ts — keep the two in sync.
    public static string DishTypeLabel(DishType d) => d switch
    {
        DishType.Breakfast => "Śniadanie",
        DishType.Main => "Danie główne",
        DishType.Soup => "Zupa",
        DishType.Salad => "Sałatka",
        DishType.Side => "Dodatek",
        DishType.Dessert => "Deser",
        DishType.Snack => "Przekąska",
        _ => "Wypieki",
    };

    public static string CuisineLabel(Cuisine c) => c switch
    {
        Cuisine.Polish => "polska",
        Cuisine.Italian => "włoska",
        Cuisine.French => "francuska",
        Cuisine.Spanish => "hiszpańska",
        Cuisine.Greek => "grecka",
        Cuisine.Mediterranean => "śródziemnomorska",
        Cuisine.MiddleEastern => "bliskowschodnia",
        Cuisine.Indian => "indyjska",
        Cuisine.Thai => "tajska",
        Cuisine.Vietnamese => "wietnamska",
        Cuisine.Chinese => "chińska",
        Cuisine.Japanese => "japońska",
        Cuisine.Korean => "koreańska",
        Cuisine.Mexican => "meksykańska",
        Cuisine.American => "amerykańska",
        _ => "inna",
    };

    public static string CategoryLabel(PantryCategory c) => c switch
    {
        PantryCategory.Produce => "Warzywa i owoce",
        PantryCategory.Fridge => "Lodówka",
        PantryCategory.Spices => "Przyprawy",
        _ => "Spiżarnia",
    };

    public static string StatusLabel(PantryStatus s) => s switch
    {
        PantryStatus.Low => "mało",
        PantryStatus.Out => "brak",
        _ => "jest",
    };

    public static string UnitLabel(PantryUnit u) => u switch
    {
        PantryUnit.G => "g",
        PantryUnit.Ml => "ml",
        _ => "szt.",
    };

    /// <summary>"400 ml", "1,5 szt." — Polish decimal comma, unit label.</summary>
    public static string QuantityLabel(PantryItem p) =>
        $"{p.Quantity.ToString("0.##", System.Globalization.CultureInfo.GetCultureInfo("pl-PL"))} {UnitLabel(p.Unit)}";

    /// <summary>
    /// "~520 kcal · B 32 g · T 18 g · W 55 g" — per-serving estimate for the recipe
    /// files and cookbook index; null when nothing has been estimated yet.
    /// </summary>
    public static string? MacroSummary(Recipe r)
    {
        var parts = new List<string>();
        if (r.KcalPerServing is int kcal) parts.Add($"~{kcal} kcal");
        var pl = System.Globalization.CultureInfo.GetCultureInfo("pl-PL");
        if (r.ProteinGrams is decimal p) parts.Add($"B {p.ToString("0.#", pl)} g");
        if (r.FatGrams is decimal f) parts.Add($"T {f.ToString("0.#", pl)} g");
        if (r.CarbGrams is decimal c) parts.Add($"W {c.ToString("0.#", pl)} g");
        return parts.Count == 0 ? null : string.Join(" · ", parts);
    }
}
