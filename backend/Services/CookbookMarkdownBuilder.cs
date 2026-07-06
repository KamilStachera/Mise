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
        sb.AppendLine("# Pamięć kulinarna — Mise");
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
        sb.AppendLine("- Ilości w spiżarni są liczbowe (g/ml/szt). Po zakupach dodawaj delty przez " +
            "`POST /pantry/adjust`; nowe pozycje katalogu tylko świadomie przez `POST /pantry`.");
        sb.AppendLine($"- Domyślnie {servings} porcje. Frytkownica beztłuszczowa: {airfryer}.");
        sb.AppendLine("- Zapisy (przepisy, spiżarnia, plan, historia) wyłącznie przez REST API — patrz `AGENTS.md` i `api.md`. Nie edytuj plików w tym folderze.");
        sb.AppendLine("- Plan tygodnia jest w `plan.md`, historia gotowania w `cooklog.md`.");
        sb.AppendLine();

        sb.AppendLine($"## Stan spiżarni ({pantry.Count} pozycji w katalogu)");
        var byStatus = pantry.ToLookup(Features.Mapping.StatusOf);
        var low = byStatus[PantryStatus.Low].Select(p => $"{p.Name} ({QuantityLabel(p)})").ToList();
        var outOf = byStatus[PantryStatus.Out].Select(p => p.Name).ToList();
        sb.AppendLine($"- Na stanie: {byStatus[PantryStatus.In].Count()} pozycji (dokładne ilości w `pantry.json`).");
        if (low.Count > 0) sb.AppendLine($"- Kończy się: {string.Join(", ", low)}.");
        if (outOf.Count > 0) sb.AppendLine($"- Brak: {string.Join(", ", outOf)}.");
        sb.AppendLine();

        sb.AppendLine($"## Zapisane przepisy ({recipes.Count})");
        foreach (var r in recipes.OrderBy(r => r.Title, Pl.Comparer))
        {
            var meta = new List<string> { $"{r.TimeMinutes} min", $"{r.Servings} porcje" };
            if (r.DishType is DishType d) meta.Add(DishTypeLabel(d).ToLowerInvariant());
            if (r.Cuisine is Cuisine c) meta.Add($"kuchnia {CuisineLabel(c)}");
            if (AirFryer.Uses(r)) meta.Add("frytkownica");
            sb.AppendLine($"- {r.Title} — {string.Join(", ", meta)} ({SourceLabel(r.Source)}). Zobacz `recipes/`.");
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
}
