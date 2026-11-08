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

/// <summary>Snack ("Przekąski") is diary-only: small bites and sweets, private like the rest of the diary.</summary>
public enum MealSlot { Breakfast, Lunch, Dinner, Snack }

public class Recipe : IHouseholdOwned
{
    public int HouseholdId { get; set; }
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Title { get; set; } = "";
    public RecipeSource Source { get; set; } = RecipeSource.Manual;
    /// <summary>
    /// Free-text origin label — a book, site or diet plan (e.g. "Daily Dieta").
    /// Shown as the eyebrow on recipe cards; null = only the <see cref="Source"/>
    /// bucket. Full-replace PUT clears it when omitted.
    /// </summary>
    public string? SourceName { get; set; }
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
public class PantryItem : IHouseholdOwned
{
    public int HouseholdId { get; set; }
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
public class ReceiptNameMapping : IHouseholdOwned
{
    public int HouseholdId { get; set; }
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

/// <summary>One row per household (unique <c>HouseholdId</c>): the "Cooking Profile" fed to the AI.</summary>
public class Preferences : IHouseholdOwned
{
    public int HouseholdId { get; set; }
    public int Id { get; set; }

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
    public int PreferencesId { get; set; }
    public Preferences? Preferences { get; set; }

    public string Name { get; set; } = "";
    public bool Favorite { get; set; }
    public int Order { get; set; }
}

public class ShoppingItem : IHouseholdOwned
{
    public int HouseholdId { get; set; }
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

/// <summary>Aisle-ish grouping for the household supplies list. Guessed from the name.</summary>
public enum SupplyCategory { Cleaning, Hygiene, Paper, Kitchen, Pets, Other }

/// <summary>
/// One non-food household item to buy (papier toaletowy, płyn do naczyń). Deliberately
/// independent of both the pantry and <see cref="ShoppingItem"/>: no ingredient matching,
/// no PantryItemId, no sync in either direction — rows only ever come from manual entry
/// or an agent. Name-only by design; household goods do not fit g/ml/szt.
/// </summary>
public class SupplyItem : IHouseholdOwned
{
    public int HouseholdId { get; set; }
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Name { get; set; } = "";
    public SupplyCategory Category { get; set; } = SupplyCategory.Other;
    public bool Checked { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}

/// <summary>
/// Learned "how often does this land on the list" tally, keyed by the normalized name so
/// "Papier toaletowy" and "papier toaletowy" are one entry. This row deliberately outlives
/// the <see cref="SupplyItem"/> rows: clear-checked hard-deletes items, so without a
/// separate tally the history that "hot items" is computed from would be destroyed.
/// </summary>
public class SupplyFavorite : IHouseholdOwned
{
    public int HouseholdId { get; set; }
    public Guid Id { get; set; } = Guid.NewGuid();
    /// <summary>Identity key — IngredientMatcher.Normalize of the name. Unique.</summary>
    public string NormalizedName { get; set; } = "";
    /// <summary>Display form: the most recently used spelling.</summary>
    public string Name { get; set; } = "";
    public SupplyCategory Category { get; set; } = SupplyCategory.Other;
    /// <summary>Times this has been added to the list. Never decremented.</summary>
    public int AddCount { get; set; }
    /// <summary>Null for a seeded suggestion that has never actually been added.</summary>
    public DateTimeOffset? LastAddedAt { get; set; }
    /// <summary>User pinned it: always leads the hot list, whatever the count.</summary>
    public bool Pinned { get; set; }
    /// <summary>User dismissed it: never suggested, however high the count.</summary>
    public bool Hidden { get; set; }
}

/// <summary>A "we cooked this" journal entry — the feedback loop the AI learns from.</summary>
public class CookLogEntry : IHouseholdOwned
{
    public int HouseholdId { get; set; }
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

/// <summary>
/// One item on the calendar: a planned meal or something eaten (the diary). A slot can
/// hold several entries. Planned → eaten is <see cref="EatenAt"/>; nutrition rules live in
/// <c>DiaryService</c>.
/// </summary>
public class PlanEntry : IHouseholdOwned, IPersonOwned
{
    public int HouseholdId { get; set; }
    public Guid Id { get; set; } = Guid.NewGuid();
    /// <summary>
    /// Whose calendar/diary this is (<see cref="Person"/>). Defaults to person 1 — agents and
    /// the household meal plan act for her; shopping ignores the owner.
    /// </summary>
    public int PersonId { get; set; }
    public DateOnly Date { get; set; }
    public MealSlot Slot { get; set; } = MealSlot.Lunch;

    /// <summary>Optional link to a saved recipe; Title is the freeform fallback.</summary>
    public Guid? RecipeId { get; set; }
    public Recipe? Recipe { get; set; }

    public string Title { get; set; } = "";
    public string Note { get; set; } = "";

    /// <summary>Portions of the recipe this entry stands for (×0,5 / ×1 / ×1,5…). 1 for products.</summary>
    public decimal Portions { get; set; } = 1;
    /// <summary>Grams eaten, for products logged per 100 g; display only — <see cref="Kcal"/> is already the total.</summary>
    public decimal? Grams { get; set; }

    /// <summary>
    /// Nutrition TOTALS for this entry (not per portion). Recipe entries: null while
    /// planned (computed live from the recipe × <see cref="Portions"/>), a snapshot once
    /// eaten so later recipe edits never rewrite past days. Non-recipe entries: the values
    /// she typed (or a favourite's), null = unknown ("brak kcal").
    /// </summary>
    public int? Kcal { get; set; }
    public decimal? Protein { get; set; }
    public decimal? Fat { get; set; }
    public decimal? Carbs { get; set; }

    /// <summary>Null = planned; set = eaten.</summary>
    public DateTimeOffset? EatenAt { get; set; }

    /// <summary>The pot this portion comes from (cook day or leftover); null for ordinary entries.</summary>
    public Guid? CookId { get; set; }
    public Cook? Cook { get; set; }
    /// <summary>
    /// A later portion of <see cref="Cook"/> ("resztki"). Leftovers are never bought: shopping
    /// only counts the cook-day entry, scaled to the whole pot.
    /// </summary>
    public bool IsLeftover { get; set; }

    /// <summary>
    /// The day's catering box, written by <c>CateringService</c> as an eaten snapshot of
    /// <see cref="Catering"/>. Never recreated once deleted (see <see cref="Catering.MaterializedThrough"/>).
    /// </summary>
    public bool IsCatering { get; set; }

    /// <summary>
    /// True once the user waved off the "mark as cooked" reminder for this entry
    /// (meal skipped / eaten out); such entries never reappear in /plan/pending-cook.
    /// </summary>
    public bool CookReminderDismissed { get; set; }

    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
}

/// <summary>
/// One pot cooked for several days ("Gotuję na kilka dni"). Its portions are spread over
/// plan entries (<see cref="PlanEntry.CookId"/>): the cook-day entry plus leftovers. What
/// is neither assigned nor discarded sits "W lodówce".
/// </summary>
public class Cook : IHouseholdOwned, IPersonOwned
{
    public int HouseholdId { get; set; }
    public Guid Id { get; set; } = Guid.NewGuid();
    /// <summary>Whose fridge the pot sits in ("W lodówce" is per person).</summary>
    public int PersonId { get; set; }
    public Guid? RecipeId { get; set; }
    public Recipe? Recipe { get; set; }
    /// <summary>Recipe title snapshot (survives recipe deletion).</summary>
    public string Title { get; set; } = "";
    /// <summary>Day the pot is cooked — the date of its cook-day entry.</summary>
    public DateOnly Date { get; set; }
    /// <summary>Portions in the pot; also the shopping scale for the cook-day entry.</summary>
    public int Portions { get; set; } = 2;
    /// <summary>Portions thrown away ("wyrzucone"); they leave the fridge without being eaten.</summary>
    public int DiscardedPortions { get; set; }
    public List<PlanEntry> Entries { get; set; } = new();
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}

/// <summary>
/// A snack she logs often (Kinder Bueno 245 kcal) — the "Ulubione" chips in Szybki wpis.
/// Same tally idea as <see cref="SupplyFavorite"/>: ranked pinned → decayed count.
/// Nutrition is per portion, or per 100 g when <see cref="Per100g"/>.
/// </summary>
public class FoodFavorite : IHouseholdOwned, IPersonOwned
{
    public int HouseholdId { get; set; }
    public Guid Id { get; set; } = Guid.NewGuid();
    public int PersonId { get; set; }
    /// <summary>Identity key — IngredientMatcher.Normalize of the name. Unique per person.</summary>
    public string NormalizedName { get; set; } = "";
    public string Name { get; set; } = "";
    public int Kcal { get; set; }
    public decimal? Protein { get; set; }
    public decimal? Fat { get; set; }
    public decimal? Carbs { get; set; }
    public bool Per100g { get; set; }
    /// <summary>Grams used last time (per-100 g favourites log this amount on a chip tap).</summary>
    public decimal? LastGrams { get; set; }
    /// <summary>EAN from a barcode scan; lets a re-scan skip the Open Food Facts lookup.</summary>
    public string? Barcode { get; set; }
    public int AddCount { get; set; }
    public DateTimeOffset? LastAddedAt { get; set; }
    public bool Pinned { get; set; }
    public bool Hidden { get; set; }
}

public enum BodySex { Female, Male }

/// <summary>Everyday activity outside workouts — the TDEE multiplier (1.2 / 1.375 / 1.55 / 1.725).</summary>
public enum ActivityLevel { Sedentary, Light, Moderate, High }

/// <summary>
/// One row per person (key = <see cref="PersonId"/>): "Twój cel". The daily kcal target is derived (Mifflin-St Jeor →
/// TDEE → minus the pace deficit, see <c>BodyService</c>) unless <see cref="TargetKcalOverride"/>
/// is set. Current weight is not stored here — it is the latest <see cref="WeightEntry"/>.
/// Private like the diary.
/// </summary>
public class BodyProfile : IHouseholdOwned, IPersonOwned
{
    public int HouseholdId { get; set; }
    public int PersonId { get; set; }
    public BodySex Sex { get; set; } = BodySex.Female;
    public int BirthYear { get; set; }
    public int HeightCm { get; set; }
    public decimal GoalWeightKg { get; set; }
    public ActivityLevel ActivityLevel { get; set; } = ActivityLevel.Light;
    /// <summary>Planned loss per week (0.25 / 0.5 / 0.75); 7700 kcal ≈ 1 kg.</summary>
    public decimal PaceKgPerWeek { get; set; } = 0.5m;
    /// <summary>Hand-set daily target; null = computed.</summary>
    public int? TargetKcalOverride { get; set; }
    /// <summary>Hand-set protein goal in grams; null = 1.6 g per kg of current weight.</summary>
    public int? ProteinTargetOverride { get; set; }
    /// <summary>Share of band-recorded active kcal added to the day's budget (0 / 50 / 100).</summary>
    public int ActivityAddBackPercent { get; set; } = 50;
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
}

public enum MeasurementSource { Manual, HealthConnect }

/// <summary>
/// One weigh-in per person per day. A manual entry always wins; from the scale (Health Connect)
/// the day's earliest measurement is kept — the morning weight, not the after-dinner one.
/// </summary>
public class WeightEntry : IHouseholdOwned, IPersonOwned
{
    public int HouseholdId { get; set; }
    public Guid Id { get; set; } = Guid.NewGuid();
    public int PersonId { get; set; }
    public DateOnly Date { get; set; }
    public decimal Kg { get; set; }
    public MeasurementSource Source { get; set; } = MeasurementSource.Manual;
    /// <summary>When the scale measured it (Health Connect); null for manual entries.</summary>
    public DateTimeOffset? MeasuredAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}

public enum EnergyKind { Active, Total }

/// <summary>
/// One raw Health Connect energy interval as the band app wrote it. Re-sent records are
/// upserted on (PersonId, Kind, Start, End). A day's active kcal is the sum of its Active samples;
/// when the band only writes Total, active ≈ total − BMR (see <c>ActivityService</c>).
/// </summary>
public class EnergySample : IHouseholdOwned, IPersonOwned
{
    public int HouseholdId { get; set; }
    public Guid Id { get; set; } = Guid.NewGuid();
    public int PersonId { get; set; }
    public EnergyKind Kind { get; set; }
    public DateTimeOffset Start { get; set; }
    public DateTimeOffset End { get; set; }
    /// <summary>Local (Europe/Warsaw) day of <see cref="Start"/>.</summary>
    public DateOnly Date { get; set; }
    public decimal Kcal { get; set; }
    public DateTimeOffset ReceivedAt { get; set; } = DateTimeOffset.UtcNow;
}

/// <summary>
/// A training session. From the band (Health Connect) its kcal is derived from the Active
/// samples inside its window, so it is never counted twice; a manual one carries its own
/// <see cref="Kcal"/>, which adds to the day.
/// </summary>
public class Workout : IHouseholdOwned, IPersonOwned
{
    public int HouseholdId { get; set; }
    public Guid Id { get; set; } = Guid.NewGuid();
    public int PersonId { get; set; }
    public DateOnly Date { get; set; }
    public DateTimeOffset? StartedAt { get; set; }
    public int Minutes { get; set; }
    /// <summary>Manual: the kcal she entered. Health Connect: null (computed from samples).</summary>
    public int? Kcal { get; set; }
    /// <summary>Polish label (Trening siłowy, Spacer…).</summary>
    public string Type { get; set; } = "";
    public MeasurementSource Source { get; set; } = MeasurementSource.Manual;
    /// <summary>Health Connect identity: start|end instants. Unique per person when set.</summary>
    public string? ExternalKey { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}

/// <summary>
/// One per person: the band/scale sync of their phone. <see cref="Token"/> is the secret in the
/// webhook URL the phone's HC Webhook app posts to (<c>/api/hc/{token}</c>) and also says whose
/// data it is. Rotate it to cut a phone off.
/// </summary>
public class HealthSync : IHouseholdOwned, IPersonOwned
{
    public int HouseholdId { get; set; }
    public int PersonId { get; set; }
    public string Token { get; set; } = "";
    public DateTimeOffset? LastSyncAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}

/// <summary>
/// A member of a household with their own food diary, goal, weight, band and training. The
/// cookbook, pantry and shopping are shared by the household. A Google account (email) belongs
/// to at most one person, so it lands in exactly one household.
/// </summary>
public class Person : IHouseholdOwned
{
    public int HouseholdId { get; set; }
    public int Id { get; set; }
    public string Name { get; set; } = "";
    /// <summary>Google account that lands on this person's diary; null = reachable only via the switcher.</summary>
    public string? Email { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}

/// <summary>
/// The tenant: one kitchen with its own recipes, pantry, shopping, plan and people. Every
/// <see cref="IHouseholdOwned"/> row carries its id and <c>MiseDbContext</c> filters on it.
/// </summary>
public class Household
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    /// <summary>In-app Sous runs on the owner's ChatGPT plan, so the admin turns it on per household.</summary>
    public bool SousEnabled { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}

/// <summary>
/// A row that belongs to one household. <c>MiseDbContext</c> stamps <see cref="HouseholdId"/> on
/// insert from the request's tenant and hides other households' rows with a global query filter.
/// </summary>
public interface IHouseholdOwned
{
    int HouseholdId { get; set; }
}

/// <summary>A row that belongs to one person (who must be in the row's household).</summary>
public interface IPersonOwned
{
    int PersonId { get; }
}

/// <summary>
/// Diet catering ("dieta pudełkowa"): the average day of boxes, counted as eaten on the
/// delivery weekdays. <c>CateringService</c> writes one eaten <see cref="PlanEntry"/> per
/// delivery day up to today and advances <see cref="MaterializedThrough"/>, so a deleted day
/// stays deleted and editing the numbers never rewrites past days.
/// </summary>
public class Catering : IHouseholdOwned, IPersonOwned
{
    public int HouseholdId { get; set; }
    public int PersonId { get; set; }
    public bool Enabled { get; set; } = true;
    public int Kcal { get; set; }
    public decimal? Protein { get; set; }
    public decimal? Fat { get; set; }
    public decimal? Carbs { get; set; }
    /// <summary>Delivery days as a bitmask, bit 0 = Monday … bit 6 = Sunday. Default Mon–Fri.</summary>
    public int Weekdays { get; set; } = 0b0011111;
    /// <summary>First day the boxes count.</summary>
    public DateOnly StartDate { get; set; }
    /// <summary>Days up to here are done (written, or skipped on purpose); null = nothing yet.</summary>
    public DateOnly? MaterializedThrough { get; set; }
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
}

/// <summary>
/// One questionnaire answer, keyed by a question from
/// <see cref="ProfileQuestionnaire"/> (e.g. "taste.heat"). Only answered
/// questions have rows; the catalog itself lives in code.
/// </summary>
public class ProfileAnswer : IHouseholdOwned
{
    public int HouseholdId { get; set; }
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Key { get; set; } = "";
    public string Value { get; set; } = "";
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
}

public class ChatMessage : IHouseholdOwned
{
    public int HouseholdId { get; set; }
    public Guid Id { get; set; } = Guid.NewGuid();
    public string SessionId { get; set; } = "default";
    /// <summary>"ai" or "user".</summary>
    public string Role { get; set; } = "ai";
    public string Content { get; set; } = "";
    /// <summary>Optional JSON for suggestion / meal-plan cards.</summary>
    public string? MetadataJson { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}

// ───────────────────────────── Training ─────────────────────────────

/// <summary>The 17 muscle groups of free-exercise-db, one to one (see <c>ExerciseImport</c>).</summary>
public enum Muscle
{
    Abdominals, Abductors, Adductors, Biceps, Calves, Chest, Forearms, Glutes, Hamstrings,
    Lats, LowerBack, MiddleBack, Neck, Quadriceps, Shoulders, Traps, Triceps,
}

/// <summary>What an exercise needs. "No equipment" is <see cref="BodyOnly"/>.</summary>
public enum ExerciseEquipment
{
    BodyOnly, Dumbbell, Kettlebell, Bands, Barbell, EzBar, Cable, Machine,
    MedicineBall, ExerciseBall, FoamRoll, Other,
}

/// <summary>Upstream categories plus Pilates/Yoga/Mobility for exercises agents add themselves.</summary>
public enum ExerciseCategory
{
    Strength, Stretching, Plyometrics, Cardio, Powerlifting, OlympicWeightlifting, Strongman,
    Pilates, Yoga, Mobility,
}

public enum ExerciseLevel { Beginner, Intermediate, Expert }

public enum ExerciseForce { Push, Pull, Static }

public enum ExerciseMechanic { Compound, Isolation }

/// <summary>
/// One exercise of the shared training catalog (not per person). Seeded from the vendored
/// free-exercise-db JSON by <c>ExerciseImport</c>, which only ever INSERTS missing
/// <see cref="SourceId"/>s — rows are never overwritten on boot, so the Polish enrichment
/// agents add (<see cref="NamePl"/>, tips, video…) survives every restart.
/// Muscle lists hold <see cref="Muscle"/> enum names; API tokens are kebab-case ("middle-back").
/// </summary>
public class Exercise
{
    public Guid Id { get; set; } = Guid.NewGuid();
    /// <summary>free-exercise-db id ("Air_Bike"), also its image folder; null for custom exercises.</summary>
    public string? SourceId { get; set; }
    /// <summary>Null = the shared catalog; a custom exercise an agent added belongs to that household only.</summary>
    public int? HouseholdId { get; set; }
    public string NameEn { get; set; } = "";
    public string? NamePl { get; set; }
    public ExerciseCategory Category { get; set; } = ExerciseCategory.Strength;
    public ExerciseLevel Level { get; set; } = ExerciseLevel.Beginner;
    public ExerciseForce? Force { get; set; }
    public ExerciseMechanic? Mechanic { get; set; }
    public ExerciseEquipment Equipment { get; set; } = ExerciseEquipment.BodyOnly;
    public List<string> PrimaryMuscles { get; set; } = [];
    public List<string> SecondaryMuscles { get; set; } = [];
    public List<string> InstructionsEn { get; set; } = [];
    public List<string> InstructionsPl { get; set; } = [];
    /// <summary>"Na co uważać" — form cues, Polish.</summary>
    public List<string> TipsPl { get; set; } = [];
    /// <summary>"Częste błędy" — what not to do, Polish.</summary>
    public List<string> MistakesPl { get; set; } = [];
    /// <summary>YouTube demo video id (11 chars). Verified by oEmbed on write; never guessed.</summary>
    public string? YoutubeId { get; set; }
    public int? VideoStartSeconds { get; set; }
    public string? VideoTitle { get; set; }
    public string? VideoChannel { get; set; }
    /// <summary>Upstream relative image paths ("Air_Bike/0.jpg"), served as cached WebP.</summary>
    public List<string> ImagePaths { get; set; } = [];
    /// <summary>Logged in seconds (planks, holds, stretches) rather than reps.</summary>
    public bool IsTimed { get; set; }
    /// <summary>Out of the catalog (strongman, olympic lifts…); kept so references never break.</summary>
    public bool Hidden { get; set; }
    /// <summary>When an agent last wrote the Polish description; null = English only.</summary>
    public DateTimeOffset? EnrichedAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
}

public enum TrainingGoal { LoseFat, Tone, Strength, Mobility, General }

/// <summary>Where a plan day happens; Home limits exercises to <see cref="TrainingProfile.HomeEquipment"/>.</summary>
public enum TrainingLocation { Home, Gym, Any }

/// <summary>Exercises = a list she logs set by set; FollowAlong = one full YouTube workout she plays.</summary>
public enum ProgramDayKind { Exercises, FollowAlong }

/// <summary>At most one Active program per person (service + partial unique index).</summary>
public enum ProgramStatus { Active, Draft, Archived }

/// <summary>
/// The training questionnaire, one per person (like <see cref="BodyProfile"/>). Typed fields
/// on purpose: plan generation, the swap filter and scheduling read them directly.
/// </summary>
public class TrainingProfile : IHouseholdOwned, IPersonOwned
{
    public int HouseholdId { get; set; }
    public int PersonId { get; set; }
    public TrainingGoal Goal { get; set; } = TrainingGoal.General;
    public ExerciseLevel Level { get; set; } = ExerciseLevel.Beginner;
    public int DaysPerWeek { get; set; } = 3;
    public int MinutesPerSession { get; set; } = 45;
    /// <summary>Bit 0 = Monday … bit 6 = Sunday (same as <see cref="Catering.Weekdays"/>); 0 = any.</summary>
    public int PreferredWeekdays { get; set; }
    public TrainingLocation Location { get; set; } = TrainingLocation.Any;
    /// <summary><see cref="ExerciseEquipment"/> names she has at home (bodyweight is implied).</summary>
    public List<string> HomeEquipment { get; set; } = [];
    /// <summary>Tokens from <c>TrainingRules.Styles</c>: strength, pilates, yoga, hiit, stretching, cardio.</summary>
    public List<string> Styles { get; set; } = [];
    /// <summary>Injuries / pain — the plan must respect these.</summary>
    public string Limitations { get; set; } = "";
    public string Dislikes { get; set; } = "";
    public string Notes { get; set; } = "";
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
}

/// <summary>
/// A multi-week plan, written out week by week so progression lives in the data (the agent
/// writes every week). Week n spans the n-th calendar week counted from the Monday of
/// <see cref="StartDate"/>; a day is placed by (Week, Weekday) — see <c>ProgramSchedule</c>.
/// </summary>
public class TrainingProgram : IHouseholdOwned, IPersonOwned
{
    public int HouseholdId { get; set; }
    public Guid Id { get; set; } = Guid.NewGuid();
    public int PersonId { get; set; }
    public string Name { get; set; } = "";
    public string Description { get; set; } = "";
    /// <summary>The agent's reasoning, shown as "Dlaczego taki plan".</summary>
    public string Rationale { get; set; } = "";
    public DateOnly StartDate { get; set; }
    public int Weeks { get; set; } = 4;
    public ProgramStatus Status { get; set; } = ProgramStatus.Draft;
    /// <summary>"ai" or "manual".</summary>
    public string CreatedBy { get; set; } = "manual";
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
    public List<ProgramDay> Days { get; set; } = [];
}

/// <summary>One training day of a program. Unique per (Program, Week, Weekday).</summary>
public class ProgramDay
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid ProgramId { get; set; }
    public TrainingProgram? Program { get; set; }
    /// <summary>1..Program.Weeks.</summary>
    public int Week { get; set; } = 1;
    /// <summary>0 = Monday … 6 = Sunday.</summary>
    public int Weekday { get; set; }
    /// <summary>"Dół ciała A" — same name across weeks = the same workout, progressed.</summary>
    public string Name { get; set; } = "";
    public ProgramDayKind Kind { get; set; } = ProgramDayKind.Exercises;
    public TrainingLocation Location { get; set; } = TrainingLocation.Any;
    public string Notes { get; set; } = "";
    /// <summary>FollowAlong only: the verified YouTube workout to play.</summary>
    public string? VideoYoutubeId { get; set; }
    public string? VideoTitle { get; set; }
    public int? VideoMinutes { get; set; }
    /// <summary>FollowAlong only: Polish label for the activity log ("Pilates", "HIIT").</summary>
    public string? WorkoutType { get; set; }
    public List<ProgramExercise> Exercises { get; set; } = [];
}

/// <summary>
/// One exercise slot of a day: sets × (RepsMin–RepsMax reps | Seconds), rest, optional target kg.
/// Slots sharing a <see cref="SupersetGroup"/> are done back to back.
/// </summary>
public class ProgramExercise
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid ProgramDayId { get; set; }
    public ProgramDay? Day { get; set; }
    public int Order { get; set; }
    public Guid ExerciseId { get; set; }
    public Exercise? Exercise { get; set; }
    public int Sets { get; set; } = 3;
    public int? RepsMin { get; set; }
    public int? RepsMax { get; set; }
    /// <summary>Timed exercises (planks, holds): seconds per set instead of reps.</summary>
    public int? Seconds { get; set; }
    public int RestSeconds { get; set; } = 60;
    public decimal? TargetKg { get; set; }
    public string Notes { get; set; } = "";
    public string? SupersetGroup { get; set; }
}

// ───────────────────────────── Access ─────────────────────────────

/// <summary>
/// A personal API key for agents/MCP. It acts as its person, in that person's household. Only the
/// SHA-256 of the key is stored; the plain key is shown once at creation.
/// </summary>
public class ApiKey : IHouseholdOwned, IPersonOwned
{
    public int HouseholdId { get; set; }
    public Guid Id { get; set; } = Guid.NewGuid();
    public int PersonId { get; set; }
    public string Name { get; set; } = "";
    /// <summary>Hex SHA-256 of the full key.</summary>
    public string KeyHash { get; set; } = "";
    /// <summary>The first characters of the key, to tell keys apart in the UI.</summary>
    public string Prefix { get; set; } = "";
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? LastUsedAt { get; set; }
    public DateTimeOffset? RevokedAt { get; set; }
}
