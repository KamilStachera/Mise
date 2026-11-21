using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Mise.Api.Domain;
using Mise.Api.Services.Training;

namespace Mise.Api.Services;

/// <summary>Per-portion estimate; nothing is saved — the person reviews it and saves via PATCH /nutrition.</summary>
public sealed record NutritionEstimate(int Kcal, decimal Protein, decimal Fat, decimal Carbs, string Note);

/// <summary>Sous is off for this household or the deployment (not AI_PROVIDER=codex).</summary>
public sealed class NutritionEstimateUnavailableException(string message) : Exception(message);

/// <summary>
/// "Przelicz makro": after someone edits a recipe's ingredients (less cheese…), asks GPT through
/// the Sous background job (<see cref="ISousJobs"/>, fresh thread, web search, no MCP tools) for
/// kcal and macros of ONE portion — the whole recipe as written divided by
/// <see cref="Recipe.Servings"/>. The pantry has no nutrition data, so this is an estimate;
/// the result is validated here and only returned, never written.
/// </summary>
public sealed class RecipeNutritionEstimator(ISousJobs sous, IConfiguration config)
{
    public bool Available =>
        string.Equals(config["AI_PROVIDER"]?.Trim(), "codex", StringComparison.OrdinalIgnoreCase);

    public async Task<NutritionEstimate> EstimateAsync(Recipe recipe, CancellationToken ct)
    {
        if (!Available)
            throw new NutritionEstimateUnavailableException("Przeliczanie makro wymaga Sous (AI_PROVIDER=codex).");
        if (recipe.Ingredients.Count == 0)
            throw new ArgumentException("Przepis nie ma składników — nie ma czego przeliczyć.");

        var text = await sous.RunAsync(BuildPrompt(recipe), OutputSchema, ct);
        return Parse(text) ?? throw new InvalidOperationException("Sous zwrócił niepoprawny wynik — spróbuj ponownie.");
    }

    public static string BuildPrompt(Recipe recipe)
    {
        var pl = CultureInfo.GetCultureInfo("pl-PL");
        var servings = Math.Max(1, recipe.Servings);
        var sb = new StringBuilder();
        sb.AppendLine("Jesteś dietetykiem. Oszacuj wartości odżywcze JEDNEJ porcji dania.");
        sb.AppendLine($"Cały przepis poniżej (ilości jak zapisane) to {servings} " +
            $"{(servings == 1 ? "porcja" : servings < 5 ? "porcje" : "porcji")}; " +
            $"policz całe danie i podziel przez {servings}.");
        sb.AppendLine("Licz z podanych ilości surowych produktów (tabele typu USDA/IŻŻ; sprawdź w sieci, gdy " +
            "produkt jest nietypowy). Ilości opisowe (łyżka, szt., kromka) przelicz na gramy typowymi wagami. " +
            "Uwzględnij tłuszcz do smażenia z kroków, jeśli jest w składnikach. Nie zaokrąglaj w górę „na zapas”.");
        sb.AppendLine();
        sb.AppendLine($"Danie: {recipe.Title}");
        sb.AppendLine("Składniki:");
        foreach (var i in recipe.Ingredients.OrderBy(i => i.Order))
        {
            var amount = i.AmountValue is decimal v && i.AmountUnit is PantryUnit u
                ? $" [{v.ToString("0.##", pl)} {CookbookMarkdownBuilder.UnitLabel(u)}]"
                : "";
            var alt = string.IsNullOrWhiteSpace(i.AlternativeGroup) ? "" : $" (zamiennik w grupie „{i.AlternativeGroup}” — licz tylko jedną opcję z grupy)";
            var detail = string.IsNullOrWhiteSpace(i.DisplayText) ? "" : $" — {i.DisplayText}";
            sb.AppendLine($"- {i.Name}: {i.Quantity}{amount}{detail}{alt}");
        }
        if (recipe.Steps.Count > 0)
        {
            sb.AppendLine("Kroki (tylko dla kontekstu obróbki):");
            foreach (var s in recipe.Steps.OrderBy(s => s.Order).Take(12))
                sb.AppendLine($"- {s.Text}");
        }
        sb.AppendLine();
        sb.AppendLine("Zwróć kcal (liczba całkowita) oraz białko, tłuszcz i węglowodany w gramach na JEDNĄ porcję, " +
            "a w note jedno krótkie zdanie po polsku: co najbardziej wpływa na wynik albo jakie założenie przyjąłeś.");
        return sb.ToString();
    }

    public static readonly JsonObject OutputSchema = JsonNode.Parse("""
        {
          "type": "object",
          "additionalProperties": false,
          "required": ["kcal", "protein", "fat", "carbs", "note"],
          "properties": {
            "kcal": { "type": "integer" },
            "protein": { "type": "number" },
            "fat": { "type": "number" },
            "carbs": { "type": "number" },
            "note": { "type": "string" }
          }
        }
        """)!.AsObject();

    /// <summary>Null when the text isn't the schema's JSON or the numbers are implausible for one portion.</summary>
    public static NutritionEstimate? Parse(string text)
    {
        try
        {
            using var doc = JsonDocument.Parse(text);
            var root = doc.RootElement;
            var kcal = root.GetProperty("kcal").GetDecimal();
            var protein = root.GetProperty("protein").GetDecimal();
            var fat = root.GetProperty("fat").GetDecimal();
            var carbs = root.GetProperty("carbs").GetDecimal();
            var note = root.TryGetProperty("note", out var n) && n.ValueKind == JsonValueKind.String ? n.GetString()!.Trim() : "";
            if (kcal is <= 0 or > 5000 || protein is < 0 or > 400 || fat is < 0 or > 400 || carbs is < 0 or > 800)
                return null;
            return new NutritionEstimate(
                (int)Math.Round(kcal, MidpointRounding.AwayFromZero),
                Math.Round(protein, 1), Math.Round(fat, 1), Math.Round(carbs, 1),
                note.Length > 300 ? note[..300] : note);
        }
        catch (Exception e) when (e is JsonException or KeyNotFoundException or InvalidOperationException or FormatException)
        {
            return null;
        }
    }
}
