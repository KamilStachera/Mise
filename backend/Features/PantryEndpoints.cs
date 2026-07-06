using Microsoft.EntityFrameworkCore;
using Mise.Api.Data;
using Mise.Api.Domain;
using Mise.Api.Services;

namespace Mise.Api.Features;

public static class PantryEndpoints
{
    private static readonly PantryCategory[] Order =
        { PantryCategory.Produce, PantryCategory.Fridge, PantryCategory.Pantry, PantryCategory.Spices };

    private const string CreateHint =
        "Nie ma w katalogu — nic nie utworzono. Wariant istniejącej pozycji (np. 'bułka " +
        "kajzerka' → 'Pieczywo')? Dodaj alias (add_pantry_aliases / PUT /pantry/{id}) " +
        "i ponów. Nowy stały produkt? POST /pantry (create_pantry_item) z unit i category. " +
        "Jednorazowy zakup? Pomiń.";

    public static RouteGroupBuilder MapPantry(this RouteGroupBuilder api)
    {
        var g = api.MapGroup("/pantry").WithTags("Pantry");

        g.MapGet("/", async (MiseDbContext db) =>
        {
            var items = await db.PantryItems.AsNoTracking().ToListAsync();
            var groups = Order.Select(cat => new PantryGroupDto(
                cat.ToString(),
                items.Where(i => i.Category == cat)
                     .OrderBy(i => i.Name, Pl.Comparer)
                     .Select(Mapping.ToDto)
                     .ToList()))
                .Where(gr => gr.Items.Count > 0)
                .ToList();
            return Results.Ok(groups);
        });

        // Quick absolute set for the UI stepper; clamped at 0 (0 = "Brak", item stays listed).
        g.MapPatch("/{id:guid}/quantity", async (Guid id, PantryQuantityInput input,
            MiseDbContext db, ContextExportService export) =>
        {
            var item = await db.PantryItems.FirstOrDefaultAsync(p => p.Id == id);
            if (item is null) return Results.NotFound();
            item.Quantity = Math.Max(0, input.Quantity);
            item.UpdatedAt = DateTimeOffset.UtcNow;
            await db.SaveChangesAsync();
            await export.ExportAsync();
            return Results.Ok(Mapping.ToDto(item));
        });

        g.MapPut("/{id:guid}", async (Guid id, PantryItemInput input, MiseDbContext db,
            IngredientMatcher matcher, ContextExportService export) =>
        {
            if (!Mapping.TryParseUnit(input.Unit, out var unit))
                return BadUnit();
            var item = await db.PantryItems.FirstOrDefaultAsync(p => p.Id == id);
            if (item is null) return Results.NotFound();
            item.Name = input.Name.Trim();
            item.Category = Mapping.ParseCategory(input.Category);
            // Changing the unit reinterprets the stored quantity; callers adjust it themselves.
            if (unit is PantryUnit u) item.Unit = u;
            if (input.Quantity is decimal q) item.Quantity = Math.Max(0, q);
            item.LowThreshold = input.LowThreshold;
            if (input.Aliases is not null)
                item.Aliases = JoinAliases(input.Aliases);
            item.UpdatedAt = DateTimeOffset.UtcNow;
            await RelinkUnmatchedIngredientsAsync(db, matcher, item);
            await db.SaveChangesAsync();
            await export.ExportAsync();
            return Results.Ok(Mapping.ToDto(item));
        });

        // The ONLY way a new catalog item comes into being — deliberate, with a unit.
        // A fuzzy duplicate is a 409 so agents merge into the existing item instead.
        g.MapPost("/", async (PantryItemInput input, MiseDbContext db,
            IngredientMatcher matcher, ContextExportService export) =>
        {
            var name = input.Name?.Trim() ?? "";
            if (name.Length == 0)
                return Results.BadRequest(new { error = "Podaj nazwę." });
            if (!Mapping.TryParseUnit(input.Unit, out var unit) || unit is null)
                return BadUnit();

            var pantry = await db.PantryItems.ToListAsync();
            // Same strict match as adjust/bulk: "Jajko" duplicates "Jajka", but
            // "Papryka ostra" is a different product than "Papryka" — allow it.
            var existing = FindByName(name, pantry, matcher);
            if (existing is not null)
                return Results.Conflict(new
                {
                    error = "Już jest w katalogu — zaktualizuj istniejącą pozycję.",
                    existing = Mapping.ToDto(existing),
                });

            var item = new PantryItem
            {
                Name = name,
                Category = Mapping.ParseCategory(input.Category),
                Unit = unit.Value,
                Quantity = Math.Max(0, input.Quantity ?? 0),
                LowThreshold = input.LowThreshold,
                Aliases = JoinAliases(input.Aliases ?? new()),
            };
            db.PantryItems.Add(item);
            await RelinkUnmatchedIngredientsAsync(db, matcher, item);
            await db.SaveChangesAsync();
            await export.ExportAsync();
            return Results.Created($"/api/pantry/{item.Id}", Mapping.ToDto(item));
        });

        g.MapDelete("/{id:guid}", async (Guid id, MiseDbContext db, ContextExportService export) =>
        {
            var item = await db.PantryItems.FirstOrDefaultAsync(p => p.Id == id);
            if (item is null) return Results.NotFound();
            db.PantryItems.Remove(item);
            await db.SaveChangesAsync();
            await export.ExportAsync();
            return Results.NoContent();
        });

        // Delta adds — the receipt flow: "bought 1000 ml milk" adds to what's there.
        // Match-only: unknown names come back in notInCatalog, nothing is created.
        g.MapPost("/adjust", async (PantryAdjustInput input, MiseDbContext db,
            IngredientMatcher matcher, ContextExportService export) =>
        {
            var pantry = await db.PantryItems.ToListAsync();
            var updated = new List<PantryItemDto>();
            var notInCatalog = new List<UnmatchedItemDto>();

            foreach (var raw in input.Items ?? new())
            {
                var name = raw.Name?.Trim() ?? "";
                if (name.Length == 0) continue;

                var item = FindByName(name, pantry, matcher);
                if (item is null)
                {
                    notInCatalog.Add(new UnmatchedItemDto(name, CreateHint));
                    continue;
                }
                if (!QuantityParser.TryConvert(raw.Quantity, raw.Unit, item.Unit, out var delta))
                {
                    notInCatalog.Add(new UnmatchedItemDto(name,
                        $"Jednostka nie pasuje: '{item.Name}' jest w {Mapping.UnitString(item.Unit)}, " +
                        $"podano '{raw.Unit}'. Przelicz i spróbuj ponownie."));
                    continue;
                }
                item.Quantity = Math.Max(0, item.Quantity + delta);
                item.UpdatedAt = DateTimeOffset.UtcNow;
                updated.Add(Mapping.ToDto(item));
            }

            await db.SaveChangesAsync();
            await export.ExportAsync();
            return Results.Ok(new PantryAdjustResultDto(updated, notInCatalog));
        });

        // Absolute sets — inventory correction ("the fridge photo says 3 eggs").
        // Match-only, like /adjust: agents never create catalog entries by accident.
        g.MapPost("/bulk", async (PantryBulkInput input, MiseDbContext db,
            IngredientMatcher matcher, ContextExportService export) =>
        {
            var pantry = await db.PantryItems.ToListAsync();
            var results = new List<PantryItemDto>();
            var notInCatalog = new List<UnmatchedItemDto>();

            foreach (var raw in input.Items ?? new())
            {
                var name = raw.Name?.Trim() ?? "";
                if (name.Length == 0) continue;

                var item = FindByName(name, pantry, matcher);
                if (item is null)
                {
                    notInCatalog.Add(new UnmatchedItemDto(name, CreateHint));
                    continue;
                }
                if (!QuantityParser.TryConvert(raw.Quantity, raw.Unit, item.Unit, out var quantity))
                {
                    notInCatalog.Add(new UnmatchedItemDto(name,
                        $"Jednostka nie pasuje: '{item.Name}' jest w {Mapping.UnitString(item.Unit)}, " +
                        $"podano '{raw.Unit}'. Przelicz i spróbuj ponownie."));
                    continue;
                }
                item.Quantity = Math.Max(0, quantity);
                if (!string.IsNullOrWhiteSpace(raw.Category))
                    item.Category = Mapping.ParseCategory(raw.Category);
                if (raw.LowThreshold is decimal low)
                    item.LowThreshold = low;
                item.UpdatedAt = DateTimeOffset.UtcNow;
                results.Add(Mapping.ToDto(item));
            }

            await db.SaveChangesAsync();
            await export.ExportAsync();
            return Results.Ok(new PantryBulkResultDto(results.Count, results, notInCatalog));
        });

        return api;
    }

    /// <summary>
    /// Exact normalized name/alias match first, then fuzzy limited to full
    /// bidirectional matches — loose containment must not mutate stock.
    /// </summary>
    private static PantryItem? FindByName(string name, List<PantryItem> pantry, IngredientMatcher matcher)
    {
        var norm = IngredientMatcher.Normalize(name);
        return pantry.FirstOrDefault(p =>
                IngredientMatcher.NamesOf(p).Any(n => IngredientMatcher.Normalize(n) == norm))
            ?? matcher.FindMatch(name, pantry, IngredientMatcher.ExactishScore);
    }

    private static string JoinAliases(IEnumerable<string> aliases) =>
        string.Join(';', aliases.Select(a => a.Trim()).Where(a => a.Length > 0));

    private static IResult BadUnit() => Results.BadRequest(new
    {
        error = "Nieznana jednostka.",
        allowed = Mapping.AllowedUnits,
    });

    /// <summary>
    /// A new or renamed pantry item may now match recipe ingredients that had no
    /// pantry link (e.g. add "Feta" and the shakshuka's feta stops being "to buy").
    /// </summary>
    private static async Task RelinkUnmatchedIngredientsAsync(
        MiseDbContext db, IngredientMatcher matcher, PantryItem item)
    {
        var unlinked = await db.RecipeIngredients.Where(i => i.PantryItemId == null).ToListAsync();
        var candidate = new[] { item };
        foreach (var ing in unlinked)
        {
            if (matcher.FindMatch(ing.Name, candidate) is not null)
                ing.PantryItemId = item.Id;
        }
    }
}
