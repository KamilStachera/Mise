using Microsoft.EntityFrameworkCore;
using Mise.Api.Data;
using Mise.Api.Domain;

namespace Mise.Api.Services;

/// <summary>Nutrition totals of one calendar entry; Missing = nothing to count ("brak kcal").</summary>
public readonly record struct EntryNutrition(int? Kcal, decimal? Protein, decimal? Fat, decimal? Carbs, bool Missing);

/// <summary>A diary rule was broken; the message is Polish and goes straight to the UI.</summary>
public sealed class DiaryException(string message, int status = StatusCodes.Status400BadRequest) : Exception(message)
{
    public int Status { get; } = status;
}

/// <summary>
/// The food diary on top of the plan: planned/eaten entries, nutrition snapshots, pots
/// spread over several days (<see cref="Cook"/>) and the snack favourites. Every rule that
/// is not plain CRUD lives here because tests only reach Services/ (no WebApplicationFactory).
/// New entries, the fridge and the favourites belong to the request's <see cref="PersonScope"/>;
/// by-id operations work on anyone's rows (the two of them may edit each other's diary).
/// </summary>
public class DiaryService(MiseDbContext db, PersonScope? person = null)
{
    private readonly int pid = (person ?? PersonScope.Default).Id;

    public const int MaxPotPortions = 12;
    public const decimal MaxEntryPortions = 10;
    /// <summary>How many favourite chips Szybki wpis shows.</summary>
    public const int HotCap = 10;
    /// <summary>Pots older than this drop out of "W lodówce" — cooked food doesn't keep longer.</summary>
    public const int FridgeDays = 7;
    /// <summary>Snack habits change faster than household restocking (45 d), so they fade sooner.</summary>
    private const double DecayDays = 21.0;

    // ---- nutrition ----

    /// <summary>
    /// Totals for an entry. A planned recipe entry is the live estimate × portions; an eaten one
    /// is its snapshot (live again only if the recipe had no estimate when it was eaten);
    /// typed entries are what she typed. Needs <see cref="PlanEntry.Recipe"/> loaded.
    /// </summary>
    public static EntryNutrition Nutrition(PlanEntry e)
    {
        if (e.RecipeId is not null && e.EatenAt is null && e.Recipe is not null)
            return FromRecipe(e.Recipe, e.Portions);
        if (e.Kcal is not null)
            return new(e.Kcal, e.Protein, e.Fat, e.Carbs, false);
        if (e.Recipe is not null)
            return FromRecipe(e.Recipe, e.Portions);
        return new(null, null, null, null, true);
    }

    public static EntryNutrition FromRecipe(Recipe r, decimal portions)
    {
        if (r.KcalPerServing is not int kcal) return new(null, null, null, null, true);
        return new((int)Math.Round(kcal * portions, MidpointRounding.AwayFromZero),
            Times(r.ProteinGrams, portions), Times(r.FatGrams, portions), Times(r.CarbGrams, portions), false);
    }

    private static decimal? Times(decimal? grams, decimal factor) =>
        grams is decimal g ? Math.Round(g * factor, 1) : null;

    /// <summary>
    /// Planned ↔ eaten. Eating a recipe entry freezes its nutrition (snapshot); un-eating
    /// drops the snapshot so the live estimate applies again. Typed values are never touched.
    /// </summary>
    public static void SetEaten(PlanEntry e, bool eaten)
    {
        if (eaten)
        {
            e.EatenAt ??= DateTimeOffset.UtcNow;
            Snapshot(e);
        }
        else
        {
            e.EatenAt = null;
            if (e.RecipeId is not null) (e.Kcal, e.Protein, e.Fat, e.Carbs) = (null, null, null, null);
        }
    }

    /// <summary>Re-freezes an eaten recipe entry's nutrition (after a portion change). No-op otherwise.</summary>
    public static void Snapshot(PlanEntry e)
    {
        if (e.EatenAt is null || e.RecipeId is null || e.Recipe is null) return;
        var n = FromRecipe(e.Recipe, e.Portions);
        (e.Kcal, e.Protein, e.Fat, e.Carbs) = (n.Kcal, n.Protein, n.Fat, n.Carbs);
    }

    public static decimal ClampPortions(decimal? portions) =>
        Math.Clamp(Math.Round(portions ?? 1, 2), 0.25m, MaxEntryPortions);

    // ---- entries ----

    /// <summary>Adds a calendar entry (never replaces); optionally remembers it as a favourite.</summary>
    public async Task<PlanEntry> AddEntryAsync(DateOnly date, MealSlot slot, Guid? recipeId, string? title,
        string? note, decimal? portions, decimal? grams, int? kcal, decimal? protein, decimal? fat,
        decimal? carbs, bool eaten, CancellationToken ct = default)
    {
        Recipe? recipe = null;
        if (recipeId is Guid rid)
        {
            recipe = await db.Recipes.FirstOrDefaultAsync(r => r.Id == rid, ct)
                ?? throw new DiaryException("Nie ma takiego przepisu.", StatusCodes.Status404NotFound);
        }
        var name = title?.Trim() ?? "";
        if (recipe is null && name.Length == 0) throw new DiaryException("Podaj przepis albo nazwę.");
        if (kcal is < 0 or > 10000) throw new DiaryException("Kcal poza zakresem.");

        var entry = new PlanEntry
        {
            PersonId = pid,
            Date = date,
            Slot = slot,
            RecipeId = recipe?.Id,
            Recipe = recipe,
            Title = recipe is null ? name : "",
            Note = note?.Trim() ?? "",
            Portions = recipe is null ? 1 : ClampPortions(portions),
            Grams = grams is > 0 ? grams : null,
        };
        if (recipe is null) (entry.Kcal, entry.Protein, entry.Fat, entry.Carbs) = (kcal, protein, fat, carbs);
        if (eaten) SetEaten(entry, true);
        db.PlanEntries.Add(entry);
        await db.SaveChangesAsync(ct);
        return entry;
    }

    /// <summary>
    /// Deletes an entry. Deleting a pot's cook day drops the pot: its planned leftovers go too,
    /// eaten ones stay in the diary as ordinary entries (they were eaten, after all).
    /// </summary>
    public async Task<bool> DeleteEntryAsync(Guid id, CancellationToken ct = default)
    {
        var entry = await db.PlanEntries.FirstOrDefaultAsync(e => e.Id == id, ct);
        if (entry is null) return false;
        if (entry.CookId is Guid cookId && !entry.IsLeftover)
        {
            var cook = await db.Cooks.Include(c => c.Entries).FirstAsync(c => c.Id == cookId, ct);
            foreach (var other in cook.Entries.Where(o => o.Id != entry.Id).ToList())
            {
                if (other.EatenAt is null)
                {
                    db.PlanEntries.Remove(other);
                }
                else
                {
                    other.CookId = null;
                    other.IsLeftover = false;
                }
            }
            db.Cooks.Remove(cook);
        }
        db.PlanEntries.Remove(entry);
        await db.SaveChangesAsync(ct);
        return true;
    }

    // ---- pots ("Gotuję na kilka dni") ----

    /// <summary>Unassigned, undiscarded portions — what "W lodówce" shows. Needs Entries loaded.</summary>
    public static int Remaining(Cook c)
    {
        var left = c.Portions - c.DiscardedPortions - c.Entries.Sum(e => e.Portions);
        return (int)Math.Max(0, Math.Floor(left));
    }

    /// <summary>
    /// Plans a pot: the cook day (a new entry, or an existing planned one) plus one leftover
    /// entry per assignment. Portions must cover the cook day and every assignment.
    /// </summary>
    public async Task<Cook> CreateCookAsync(Guid recipeId, int portions, DateOnly firstDate, MealSlot firstSlot,
        IReadOnlyList<(DateOnly Date, MealSlot Slot)> assignments, Guid? fromEntryId, CancellationToken ct = default)
    {
        var recipe = await db.Recipes.FirstOrDefaultAsync(r => r.Id == recipeId, ct)
            ?? throw new DiaryException("Nie ma takiego przepisu.", StatusCodes.Status404NotFound);
        ValidatePot(portions, 1 + assignments.Count);

        PlanEntry cookDay;
        if (fromEntryId is Guid fid)
        {
            cookDay = await db.PlanEntries.FirstOrDefaultAsync(e => e.Id == fid, ct)
                ?? throw new DiaryException("Nie ma takiego wpisu.", StatusCodes.Status404NotFound);
            if (cookDay.CookId is not null)
                throw new DiaryException("Ten wpis należy już do gotowania na kilka dni.", StatusCodes.Status409Conflict);
            if (cookDay.RecipeId != recipe.Id)
                throw new DiaryException("Wpis jest dla innego przepisu.");
        }
        else
        {
            cookDay = new PlanEntry { PersonId = pid, Date = firstDate, Slot = firstSlot, RecipeId = recipe.Id, Recipe = recipe };
            db.PlanEntries.Add(cookDay);
        }

        var cook = new Cook
        {
            PersonId = cookDay.PersonId, RecipeId = recipe.Id, Title = recipe.Title, Date = cookDay.Date, Portions = portions,
        };
        db.Cooks.Add(cook);
        cookDay.Cook = cook;
        cookDay.IsLeftover = false;
        cookDay.Portions = 1;
        cookDay.UpdatedAt = DateTimeOffset.UtcNow;
        AddLeftovers(cook, recipe, assignments);
        await db.SaveChangesAsync(ct);
        return cook;
    }

    /// <summary>Resizes the pot and replaces its planned leftovers; eaten portions stay put.</summary>
    public async Task<Cook> UpdateCookAsync(Guid id, int portions,
        IReadOnlyList<(DateOnly Date, MealSlot Slot)> assignments, CancellationToken ct = default)
    {
        var cook = await LoadCookAsync(id, ct)
            ?? throw new DiaryException("Nie ma takiego gotowania.", StatusCodes.Status404NotFound);
        var keep = cook.Entries.Where(e => !e.IsLeftover || e.EatenAt is not null).ToList();
        ValidatePot(portions, keep.Sum(e => e.Portions) + assignments.Count + cook.DiscardedPortions);

        foreach (var planned in cook.Entries.Except(keep).ToList())
        {
            cook.Entries.Remove(planned);
            db.PlanEntries.Remove(planned);
        }
        cook.Portions = portions;
        var recipe = cook.Recipe ?? (cook.RecipeId is Guid rid ? await db.Recipes.FirstOrDefaultAsync(r => r.Id == rid, ct) : null);
        AddLeftovers(cook, recipe, assignments);
        await db.SaveChangesAsync(ct);
        return cook;
    }

    /// <summary>"Zjem porcję": one portion out of the fridge, eaten now in the given slot.</summary>
    public async Task<PlanEntry> EatFromCookAsync(Guid id, DateOnly date, MealSlot slot, CancellationToken ct = default)
    {
        var cook = await LoadCookAsync(id, ct)
            ?? throw new DiaryException("Nie ma takiego gotowania.", StatusCodes.Status404NotFound);
        if (Remaining(cook) < 1) throw new DiaryException("W lodówce nie zostało już porcji.", StatusCodes.Status409Conflict);
        var entry = new PlanEntry
        {
            PersonId = pid,
            Date = date,
            Slot = slot,
            RecipeId = cook.RecipeId,
            Recipe = cook.Recipe,
            Title = cook.RecipeId is null ? cook.Title : "",
            Cook = cook,
            IsLeftover = true,
        };
        SetEaten(entry, true);
        db.PlanEntries.Add(entry);
        await db.SaveChangesAsync(ct);
        return entry;
    }

    /// <summary>"Wyrzucone": whatever is left leaves the fridge uneaten.</summary>
    public async Task<Cook> DiscardRestAsync(Guid id, CancellationToken ct = default)
    {
        var cook = await LoadCookAsync(id, ct)
            ?? throw new DiaryException("Nie ma takiego gotowania.", StatusCodes.Status404NotFound);
        cook.DiscardedPortions += Remaining(cook);
        await db.SaveChangesAsync(ct);
        return cook;
    }

    /// <summary>Pots cooked in the last <see cref="FridgeDays"/> days (not in the future) that still have portions.</summary>
    public async Task<List<Cook>> FridgeAsync(DateOnly today, CancellationToken ct = default)
    {
        var from = today.AddDays(-FridgeDays);
        var cooks = await db.Cooks.AsNoTracking()
            .Include(c => c.Entries)
            .Include(c => c.Recipe)
            .Where(c => c.PersonId == pid && c.Date >= from && c.Date <= today)
            .OrderByDescending(c => c.Date)
            .ToListAsync(ct);
        return cooks.Where(c => Remaining(c) > 0).ToList();
    }

    public Task<Cook?> LoadCookAsync(Guid id, CancellationToken ct = default) =>
        db.Cooks.Include(c => c.Entries).ThenInclude(e => e.Recipe)
            .Include(c => c.Recipe)
            .FirstOrDefaultAsync(c => c.Id == id, ct);

    private static void ValidatePot(decimal portions, decimal needed)
    {
        if (portions < 1 || portions > MaxPotPortions)
            throw new DiaryException($"Garnek ma od 1 do {MaxPotPortions} porcji.");
        if (needed > portions)
            throw new DiaryException("Za mało porcji na tyle dni.");
    }

    private void AddLeftovers(Cook cook, Recipe? recipe, IEnumerable<(DateOnly Date, MealSlot Slot)> assignments)
    {
        foreach (var (date, slot) in assignments)
        {
            var leftover = new PlanEntry
            {
                PersonId = cook.PersonId,
                Date = date,
                Slot = slot,
                RecipeId = recipe?.Id,
                Recipe = recipe,
                Title = recipe is null ? cook.Title : "",
                Cook = cook,
                IsLeftover = true,
            };
            cook.Entries.Add(leftover);
            db.PlanEntries.Add(leftover);
        }
    }

    // ---- favourites ("Ulubione") ----

    public static string Key(string name) => IngredientMatcher.Normalize(name);

    /// <summary>What one chip tap logs: the portion, or the usual grams of a per-100 g product.</summary>
    public static int ChipKcal(FoodFavorite f) =>
        f.Per100g ? (int)Math.Round(f.Kcal * (f.LastGrams ?? 100) / 100m, MidpointRounding.AwayFromZero) : f.Kcal;

    /// <summary>Creates or refreshes a favourite (latest values win) and counts one use.</summary>
    public async Task<FoodFavorite> RememberAsync(string name, int kcal, decimal? protein, decimal? fat,
        decimal? carbs, bool per100g, decimal? lastGrams, string? barcode, CancellationToken ct = default)
    {
        var trimmed = name.Trim();
        var key = Key(trimmed);
        if (key.Length == 0) throw new DiaryException("Podaj nazwę.");
        var f = await db.FoodFavorites.FirstOrDefaultAsync(x => x.PersonId == pid && x.NormalizedName == key, ct);
        if (f is null)
        {
            f = new FoodFavorite { PersonId = pid, NormalizedName = key };
            db.FoodFavorites.Add(f);
        }
        (f.Name, f.Kcal, f.Protein, f.Fat, f.Carbs, f.Per100g) = (trimmed, kcal, protein, fat, carbs, per100g);
        if (lastGrams is > 0) f.LastGrams = lastGrams;
        if (!string.IsNullOrWhiteSpace(barcode)) f.Barcode = barcode.Trim();
        Bump(f);
        await db.SaveChangesAsync(ct);
        return f;
    }

    /// <summary>A chip tap: logs the favourite as eaten (grams override for per-100 g) and counts the use.</summary>
    public async Task<PlanEntry> LogFavoriteAsync(Guid id, DateOnly date, MealSlot slot, decimal? grams,
        CancellationToken ct = default)
    {
        var f = await db.FoodFavorites.FirstOrDefaultAsync(x => x.Id == id, ct)
            ?? throw new DiaryException("Nie ma takiego ulubionego.", StatusCodes.Status404NotFound);
        var entry = new PlanEntry { PersonId = pid, Date = date, Slot = slot, Title = f.Name };
        if (f.Per100g)
        {
            var g = grams is > 0 ? grams.Value : f.LastGrams ?? 100;
            var factor = g / 100m;
            entry.Grams = g;
            entry.Kcal = (int)Math.Round(f.Kcal * factor, MidpointRounding.AwayFromZero);
            (entry.Protein, entry.Fat, entry.Carbs) = (Times(f.Protein, factor), Times(f.Fat, factor), Times(f.Carbs, factor));
            f.LastGrams = g;
        }
        else
        {
            (entry.Kcal, entry.Protein, entry.Fat, entry.Carbs) = (f.Kcal, f.Protein, f.Fat, f.Carbs);
        }
        SetEaten(entry, true);
        db.PlanEntries.Add(entry);
        Bump(f);
        await db.SaveChangesAsync(ct);
        return entry;
    }

    private static void Bump(FoodFavorite f)
    {
        f.AddCount++;
        f.LastAddedAt = DateTimeOffset.UtcNow;
        f.Hidden = false;
    }

    /// <summary>Pinned first, then recency-decayed count, then Polish name. Hidden ones only when asked.</summary>
    public async Task<List<FoodFavorite>> FavoritesAsync(bool includeHidden, int? cap, CancellationToken ct = default)
    {
        var all = await db.FoodFavorites.AsNoTracking()
            .Where(f => f.PersonId == pid && (includeHidden || !f.Hidden)).ToListAsync(ct);
        var now = DateTimeOffset.UtcNow;
        var ranked = all
            .OrderByDescending(f => f.Pinned)
            .ThenByDescending(f => SupplyService.DecayedScore(f.AddCount, f.LastAddedAt, now, DecayDays))
            .ThenBy(f => f.Name, Pl.Comparer);
        return (cap is int c ? ranked.Take(c) : ranked).ToList();
    }
}
