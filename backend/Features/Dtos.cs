using Mise.Api.Domain;

namespace Mise.Api.Features;

// ---- responses ----
public record RecipeListItemDto(Guid Id, string Title, string Source, int Time, int Servings,
    string Difficulty, string Tint, string Blurb, string? ImageUrl, int ToBuyCount,
    string? DishType, string? Cuisine, bool UsesAirFryer, DateTimeOffset CreatedAt);

public record IngredientDto(string Name, string Quantity, string Status);

/// <summary>One gallery photo; IsDefault marks the one shown on cards and the hero.</summary>
public record RecipeImageDto(Guid Id, string Url, bool IsDefault, DateTimeOffset CreatedAt);

public record RecipeDetailDto(Guid Id, string Title, string Source, int Time, int Servings,
    string Difficulty, string Tint, string Blurb, string? ImageUrl, string? Tip,
    List<IngredientDto> Ingredients, List<string> Steps,
    int Have, int Total, List<string> Missing,
    string? DishType, string? Cuisine, bool UsesAirFryer,
    List<RecipeImageDto> Images);

public record PantryItemDto(Guid Id, string Name, string Category, string Unit,
    decimal Quantity, decimal? LowThreshold, string Status, List<string> Aliases);
public record PantryGroupDto(string Category, List<PantryItemDto> Items);

/// <summary>A name the agent sent that matched nothing — with a hint on what to do.</summary>
public record UnmatchedItemDto(string Name, string Hint);
public record PantryAdjustResultDto(List<PantryItemDto> Updated, List<UnmatchedItemDto> NotInCatalog);

public record ShoppingItemDto(Guid Id, string Name, string Category, string Reason, bool Checked,
    string Origin, decimal? Quantity, string? Unit);
public record ShoppingListDto(List<ShoppingItemDto> Items, int Total, int CheckedCount);

public record CookProposalItemDto(Guid IngredientId, string Name, string QuantityText,
    Guid? PantryItemId, string? PantryItemName, string? Unit, decimal? PantryQuantity,
    decimal? ProposedAmount, bool Deductible, string? SkipReason);
public record CookProposalDto(Guid RecipeId, string Title, List<CookProposalItemDto> Items);
public record CookDeductedDto(Guid PantryItemId, string Name, decimal Deducted,
    decimal NewQuantity, string Status);

public record EquipmentDto(string Name, bool Favorite);
public record PreferencesDto(string HouseholdSummary, string HouseholdDetail, string SkillSummary,
    string SkillDetail, string TasteCuisines, string AvoidDietary, string EquipmentNote,
    List<EquipmentDto> Equipment);

public record CookLogEntryDto(Guid Id, Guid? RecipeId, string DishName, int? Rating, string Note, DateOnly CookedAt);
public record CookLogResultDto(CookLogEntryDto Entry, List<CookDeductedDto> Deducted);

public record PlanEntryDto(Guid Id, DateOnly Date, string Slot, Guid? RecipeId, string? RecipeTitle,
    string Title, string Note);
public record PlanRangeDto(DateOnly Start, int Days, List<PlanEntryDto> Entries);

public record PantryBulkResultDto(int Updated, List<PantryItemDto> Results,
    List<UnmatchedItemDto> NotInCatalog);

public record QuestionDto(string Key, string Label, string Type, string[]? Options, string? Placeholder);
public record QuestionnaireSectionDto(string Key, string Title, List<QuestionDto> Questions);
public record QuestionnaireDto(List<QuestionnaireSectionDto> Sections, Dictionary<string, string> Answers);

// ---- requests ----
public record IngredientInput(string Name, string? Quantity,
    decimal? AmountValue = null, string? AmountUnit = null);
public record RecipeInput(string Title, string Source, int Time, int Servings, string? Difficulty,
    string? Tint, string? Blurb, string? Tip, List<IngredientInput> Ingredients, List<string> Steps,
    string? DishType = null, string? Cuisine = null, bool? UsesAirFryer = null);

public record PantryItemInput(string Name, string Category, string Unit,
    decimal? Quantity = null, decimal? LowThreshold = null, List<string>? Aliases = null);
public record PantryQuantityInput(decimal Quantity);
/// <summary>A delta: positive = bought, negative = used up / thrown away.</summary>
public record PantryAdjustItem(string Name, decimal Quantity, string? Unit = null);
public record PantryAdjustInput(List<PantryAdjustItem> Items);

public record ShoppingItemInput(string Name, string? Category,
    decimal? Quantity = null, string? Unit = null, string? Reason = null);
public record ShoppingCheckInput(bool? Checked);

public record CookDeductionInput(Guid PantryItemId, decimal Amount, string? Unit = null);
public record CookLogInput(Guid? RecipeId, string? DishName, int? Rating, string? Note,
    DateOnly? CookedAt, List<CookDeductionInput>? Deductions = null);
public record PlanEntryInput(DateOnly Date, string Slot, Guid? RecipeId, string? Title, string? Note);
public record PlanRangeInput(DateOnly? Start, int? Days);
/// <summary>Absolute quantity set (inventory correction), matched by name — never creates.</summary>
public record PantryBulkItem(string Name, string? Category, decimal Quantity,
    string? Unit = null, decimal? LowThreshold = null);
public record PantryBulkInput(List<PantryBulkItem> Items);
public record AnswersInput(Dictionary<string, string> Answers);

public static class Mapping
{
    public static string SourceString(RecipeSource s) => s.ToString().ToLowerInvariant();

    /// <summary>Public URL for a stored recipe photo (served by the static-files mapping).</summary>
    public static string? ImageUrl(string? imagePath)
        => imagePath is null ? null : $"/api/images/{imagePath}";

    public static RecipeSource ParseSource(string? s) => (s ?? "").Trim().ToLowerInvariant() switch
    {
        "ai" => RecipeSource.Ai,
        "web" => RecipeSource.Web,
        _ => RecipeSource.Manual,
    };

    public static PantryCategory ParseCategory(string? s) => (s ?? "").Trim().ToLowerInvariant() switch
    {
        "produce" => PantryCategory.Produce,
        "fridge" => PantryCategory.Fridge,
        "spices" => PantryCategory.Spices,
        _ => PantryCategory.Pantry,
    };

    public static string StatusString(PantryStatus s) => s.ToString().ToLowerInvariant();

    /// <summary>Status is derived from quantity, never stored.</summary>
    public static PantryStatus StatusOf(PantryItem p) =>
        p.Quantity <= 0 ? PantryStatus.Out
        : p.LowThreshold is decimal t && p.Quantity < t ? PantryStatus.Low
        : PantryStatus.In;

    public static string UnitString(PantryUnit u) => u.ToString().ToLowerInvariant();

    public static readonly string[] AllowedUnits = { "g", "ml", "szt" };

    /// <summary>
    /// Strict like TryParseDishType: an agent typo must come back as a 400 with the
    /// allowed list, not be silently remapped. Null/blank means "not provided" (ok).
    /// </summary>
    public static bool TryParseUnit(string? s, out PantryUnit? unit)
    {
        unit = null;
        if (string.IsNullOrWhiteSpace(s)) return true;
        switch (s.Trim().ToLowerInvariant().TrimEnd('.'))
        {
            case "g": unit = PantryUnit.G; return true;
            case "ml": unit = PantryUnit.Ml; return true;
            case var t when t.StartsWith("szt", StringComparison.Ordinal):
                unit = PantryUnit.Szt; return true;
            default: return false;
        }
    }

    public static PantryItemDto ToDto(PantryItem p) => new(p.Id, p.Name, p.Category.ToString(),
        UnitString(p.Unit), p.Quantity, p.LowThreshold, StatusString(StatusOf(p)),
        p.Aliases.Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).ToList());

    public static ShoppingItemDto ToDto(ShoppingItem s) => new(s.Id, s.Name, s.Category, s.Reason,
        s.Checked, s.Origin.ToString().ToLowerInvariant(), s.Quantity,
        s.Unit is PantryUnit u ? UnitString(u) : null);

    public static MealSlot ParseSlot(string? s) => (s ?? "").Trim().ToLowerInvariant() switch
    {
        "breakfast" => MealSlot.Breakfast,
        "dinner" => MealSlot.Dinner,
        _ => MealSlot.Lunch,
    };

    public static string SlotString(MealSlot s) => s.ToString().ToLowerInvariant();

    public static string? DishTypeString(DishType? d) => d?.ToString().ToLowerInvariant();

    public static string? CuisineString(Cuisine? c) => c?.ToString().ToLowerInvariant();

    public static readonly string[] AllowedDishTypes =
        Enum.GetValues<DishType>().Select(d => d.ToString().ToLowerInvariant()).ToArray();

    public static readonly string[] AllowedCuisines =
        Enum.GetValues<Cuisine>().Select(c => c.ToString().ToLowerInvariant()).ToArray();

    // Unlike ParseSource these are strict: optional metadata must not be silently remapped,
    // a bad token from an agent should come back as a 400 with the allowed list.
    public static bool TryParseDishType(string? s, out DishType? result)
        => TryParseToken(s, out result);

    public static bool TryParseCuisine(string? s, out Cuisine? result)
        => TryParseToken(s, out result);

    private static bool TryParseToken<T>(string? s, out T? result) where T : struct, Enum
    {
        result = null;
        if (string.IsNullOrWhiteSpace(s)) return true;
        var token = s.Trim().Replace("-", "").Replace("_", "");
        // Enum.TryParse accepts numeric strings; only names are valid tokens here.
        if (token.Length == 0 || char.IsAsciiDigit(token[0])) return false;
        if (Enum.TryParse<T>(token, ignoreCase: true, out var value) && Enum.IsDefined(value))
        {
            result = value;
            return true;
        }
        return false;
    }

    /// <summary>
    /// Quantity-aware availability of one recipe ingredient. Shortfall is how much is
    /// missing (recipe amount minus stock) when both sides share a unit; null otherwise.
    /// </summary>
    public record Availability(string Status, decimal? Shortfall, PantryUnit? Unit);

    public static Availability IngredientAvailability(RecipeIngredient ing,
        IReadOnlyDictionary<Guid, PantryItem> pantryById)
    {
        if (ing.PantryItemId is not Guid id || !pantryById.TryGetValue(id, out var item))
            return new("unknown", ing.AmountValue, ing.AmountUnit);

        if (item.Quantity <= 0)
            return new("out", ing.AmountUnit == item.Unit ? ing.AmountValue : null, item.Unit);

        if (ing.AmountValue is decimal required && ing.AmountUnit == item.Unit
            && item.Quantity < required)
            return new("out", required - item.Quantity, item.Unit);

        // Enough for the recipe — or no comparable amount, so presence decides.
        return new(StatusString(StatusOf(item)), null, item.Unit);
    }

    /// <summary>An ingredient counts as "to buy" when it is short, out of stock or unmatched.</summary>
    public static bool IsToBuy(string status) => status is "out" or "unknown";
}
