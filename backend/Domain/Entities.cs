namespace Mise.Api.Domain;

public enum RecipeSource { Ai, Web, Manual }

/// <summary>What the dish is (a main, a soup…), not when it is eaten — that is <see cref="MealSlot"/>.</summary>
public enum DishType { Breakfast, Main, Soup, Salad, Side, Dessert, Snack, Baking }

public enum Cuisine
{
    Polish, Italian, French, Spanish, Greek, Mediterranean, MiddleEastern,
    Indian, Thai, Vietnamese, Chinese, Japanese, Korean, Mexican, American, Other,
}

public enum PantryCategory { Produce, Fridge, Pantry, Spices }

/// <summary>
/// Derived, not stored: computed from <see cref="PantryItem.Quantity"/> and
/// <see cref="PantryItem.LowThreshold"/> (0 → Out, below threshold → Low, else In).
/// </summary>
public enum PantryStatus { In, Low, Out }

/// <summary>Canonical metric units — one per pantry item, all quantities use it.</summary>
public enum PantryUnit { G, Ml, Szt }

public enum ShoppingOrigin { Recipe, Manual }

public enum MealSlot { Breakfast, Lunch, Dinner }

public class Recipe
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Title { get; set; } = "";
    public RecipeSource Source { get; set; } = RecipeSource.Manual;
    public int TimeMinutes { get; set; }
    public int Servings { get; set; } = 2;
    /// <summary>
    /// Last portion count chosen on the recipe screen; null = cook as written
    /// (<see cref="Servings"/>). When set, ingredient amounts are served scaled by
    /// SelectedServings/Servings everywhere quantities matter (detail, missing,
    /// cook-proposal, shopping demand) — see <c>RecipeScaling</c>. Reset by a full
    /// recipe update that changes the base <see cref="Servings"/>.
    /// </summary>
    public int? SelectedServings { get; set; }
    public string Difficulty { get; set; } = "Łatwe";
    /// <summary>Hex colour used for the card/hero gradient (from the design).</summary>
    public string Tint { get; set; } = "#c0552d";
    /// <summary>
    /// Filename of the default photo (one of <see cref="Images"/>); null = gradient
    /// fallback. Every upload becomes the new default; older photos stay in the gallery.
    /// </summary>
    public string? ImagePath { get; set; }
    /// <summary>
    /// True/false = explicit (set on insert/update; wins always). Null = not yet
    /// classified (older recipes) — resolved by text heuristic, see <c>AirFryer.Uses</c>.
    /// </summary>
    public bool? UsesAirFryer { get; set; }
    public string Blurb { get; set; } = "";
    public string? Tip { get; set; }
    /// <summary>Null = not yet categorised (older recipes; agents backfill via PUT).</summary>
    public DishType? DishType { get; set; }
    public Cuisine? Cuisine { get; set; }

    /// <summary>
    /// Estimated nutrition PER SERVING. Null = not yet estimated (older recipes;
    /// agents backfill via PUT, same pattern as <see cref="DishType"/>/<see cref="Cuisine"/>).
    /// </summary>
    public int? KcalPerServing { get; set; }
    public decimal? ProteinGrams { get; set; }
    public decimal? FatGrams { get; set; }
    public decimal? CarbGrams { get; set; }

    public List<RecipeIngredient> Ingredients { get; set; } = new();
    public List<RecipeStep> Steps { get; set; } = new();
    public List<RecipeImage> Images { get; set; } = new();

    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
}

public class RecipeIngredient
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid RecipeId { get; set; }
    public Recipe? Recipe { get; set; }

    public string Name { get; set; } = "";
    public string Quantity { get; set; } = "";
    /// <summary>
    /// Optional verbatim ingredient line shown to the cook, e.g.
    /// "2–4 kromki chleba na zakwasie piwnym". <see cref="Name"/> remains the
    /// canonical product used for pantry matching; null keeps the legacy
    /// "quantity + name" presentation.
    /// </summary>
    public string? DisplayText { get; set; }
    /// <summary>
    /// Optional caller-defined key joining ingredients that are substitutes for
    /// one another. All rows with the same key inside a recipe form one "A or B"
    /// requirement: any one sufficiently available option satisfies it.
    /// </summary>
    public string? AlternativeGroup { get; set; }
    public int Order { get; set; }

    /// <summary>
    /// Structured amount in the canonical unit, when the display <see cref="Quantity"/>
    /// is measurable ("100 g" → 100/G). Null = unparseable ("garść", "2 łyżki") —
    /// such ingredients fall back to presence-based availability and are skipped
    /// when deducting after cooking.
    /// </summary>
    public decimal? AmountValue { get; set; }
    public PantryUnit? AmountUnit { get; set; }

    /// <summary>Explicit link to a pantry item; drives the have/missing computation.</summary>
    public Guid? PantryItemId { get; set; }
    public PantryItem? PantryItem { get; set; }
}

/// <summary>One photo in a recipe's gallery; <see cref="Recipe.ImagePath"/> marks the default.</summary>
public class RecipeImage
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid RecipeId { get; set; }
    public Recipe? Recipe { get; set; }

    /// <summary>Stored filename inside the images dir.</summary>
    public string Path { get; set; } = "";
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}

public class RecipeStep
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid RecipeId { get; set; }
    public Recipe? Recipe { get; set; }

    public int Order { get; set; }
    public string Text { get; set; } = "";
}

/// <summary>
/// One ingredient we track. The pantry doubles as the ingredient catalog: an item
/// with <see cref="Quantity"/> 0 is "known, not at home" and stays listed, so agents
/// match against it instead of inventing near-duplicates.
/// </summary>
public class PantryItem
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Name { get; set; } = "";
    public PantryCategory Category { get; set; } = PantryCategory.Pantry;
    public PantryUnit Unit { get; set; } = PantryUnit.Szt;
    /// <summary>How much is at home, in <see cref="Unit"/>. Never negative.</summary>
    public decimal Quantity { get; set; }
    /// <summary>
    /// Conservative lower bound safe to subtract from recipe demand. It expires by
    /// category; <c>StockReliability</c> is the single source of truth for the
    /// effective planning quantity and confidence shown to callers.
    /// </summary>
    public decimal ReliableQuantity { get; set; }
    /// <summary>When <see cref="ReliableQuantity"/> was last materialised from an observation.</summary>
    public DateTimeOffset? ReliabilityUpdatedAt { get; set; }
    /// <summary>Below this the item shows as "Mało"; null = no low state.</summary>
    public decimal? LowThreshold { get; set; }
    /// <summary>Semicolon-separated alternate names fed to IngredientMatcher.</summary>
    public string Aliases { get; set; } = "";
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
}

/// <summary>
/// A store-specific raw receipt label resolved to a canonical pantry item. Receipt
/// abbreviations intentionally live outside PantryItem.Aliases so they cannot affect
/// recipe ingredient matching.
/// </summary>
public class ReceiptNameMapping
{
    public Guid Id { get; set; } = Guid.NewGuid();
    /// <summary>Normalised merchant label; empty means a global mapping.</summary>
    public string Merchant { get; set; } = "";
    public string RawName { get; set; } = "";
    public string NormalizedName { get; set; } = "";
    public Guid PantryItemId { get; set; }
    public PantryItem? PantryItem { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
}

/// <summary>Singleton row (Id = 1): the "Cooking Profile" fed to the AI.</summary>
public class Preferences
{
    public int Id { get; set; } = 1;

    public string HouseholdSummary { get; set; } = "";
    public string HouseholdDetail { get; set; } = "";
    public string SkillSummary { get; set; } = "";
    public string SkillDetail { get; set; } = "";
    public string TasteCuisines { get; set; } = "";
    public string AvoidDietary { get; set; } = "";
    public string EquipmentNote { get; set; } = "";

    public List<EquipmentItem> Equipment { get; set; } = new();
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
}

public class EquipmentItem
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public int PreferencesId { get; set; } = 1;
    public Preferences? Preferences { get; set; }

    public string Name { get; set; } = "";
    public bool Favorite { get; set; }
    public int Order { get; set; }
}

public class ShoppingItem
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Name { get; set; } = "";
    /// <summary>Display label, e.g. Produce / Fridge / Pantry / Spices / Recipe.</summary>
    public string Category { get; set; } = "";
    public string Reason { get; set; } = "";
    public bool Checked { get; set; }
    public ShoppingOrigin Origin { get; set; } = ShoppingOrigin.Manual;

    /// <summary>How much to buy, in <see cref="Unit"/>; null = unspecified amount.</summary>
    public decimal? Quantity { get; set; }
    public PantryUnit? Unit { get; set; }

    /// <summary>Provenance link to the pantry item this row restocks (helps receipt check-off).</summary>
    public Guid? PantryItemId { get; set; }
    /// <summary>
    /// Stable normalized identity for a recipe-origin "A or B" row. Null for
    /// ordinary and manual shopping items.
    /// </summary>
    public string? AlternativeKey { get; set; }
    /// <summary>Semicolon-separated pantry ids that may satisfy the alternative.</summary>
    public string? AlternativePantryItemIds { get; set; }
    public List<ShoppingContribution> Contributions { get; set; } = new();
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}

/// <summary>
/// One recipe/plan occurrence contributing demand to an unchecked recipe-origin
/// shopping row. SourceKey makes a recipe button idempotent while individual plan
/// entries remain separate occurrences.
/// </summary>
public class ShoppingContribution
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid ShoppingItemId { get; set; }
    public ShoppingItem? ShoppingItem { get; set; }

    /// <summary>Stable source identity: recipe:{id} or plan:{entryId}.</summary>
    public string SourceKey { get; set; } = "";
    /// <summary>Recipe-title snapshot used to build the shopping-list reason.</summary>
    public string SourceLabel { get; set; } = "";
    /// <summary>Full recipe demand before pantry stock is subtracted.</summary>
    public decimal? RequiredQuantity { get; set; }
    public PantryUnit? Unit { get; set; }
}

/// <summary>A "we cooked this" journal entry — the feedback loop the AI learns from.</summary>
public class CookLogEntry
{
    public Guid Id { get; set; } = Guid.NewGuid();

    /// <summary>Optional link to a saved recipe; entries survive recipe deletion.</summary>
    public Guid? RecipeId { get; set; }
    public Recipe? Recipe { get; set; }

    /// <summary>Snapshot of the recipe title, or a freeform dish name.</summary>
    public string DishName { get; set; } = "";
    /// <summary>1–5, optional.</summary>
    public int? Rating { get; set; }
    public string Note { get; set; } = "";
    public DateOnly CookedAt { get; set; } = DateOnly.FromDateTime(DateTime.Today);
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}

/// <summary>One meal on the weekly plan; unique per (Date, Slot) so writes are upserts.</summary>
public class PlanEntry
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public DateOnly Date { get; set; }
    public MealSlot Slot { get; set; } = MealSlot.Lunch;

    /// <summary>Optional link to a saved recipe; Title is the freeform fallback.</summary>
    public Guid? RecipeId { get; set; }
    public Recipe? Recipe { get; set; }

    public string Title { get; set; } = "";
    public string Note { get; set; } = "";

    /// <summary>
    /// True once the user waved off the "mark as cooked" reminder for this entry
    /// (meal skipped / eaten out); such entries never reappear in /plan/pending-cook.
    /// </summary>
    public bool CookReminderDismissed { get; set; }

    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
}

/// <summary>
/// One questionnaire answer, keyed by a question from
/// <see cref="ProfileQuestionnaire"/> (e.g. "taste.heat"). Only answered
/// questions have rows; the catalog itself lives in code.
/// </summary>
public class ProfileAnswer
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Key { get; set; } = "";
    public string Value { get; set; } = "";
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
}

public class ChatMessage
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string SessionId { get; set; } = "default";
    /// <summary>"ai" or "user".</summary>
    public string Role { get; set; } = "ai";
    public string Content { get; set; } = "";
    /// <summary>Optional JSON for suggestion / meal-plan cards.</summary>
    public string? MetadataJson { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}
