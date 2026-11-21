using Microsoft.EntityFrameworkCore;
using Mise.Api.Data;
using Mise.Api.Domain;
using Mise.Api.Services;

namespace Mise.Api.Features;

public static class ShoppingEndpoints
{
    public static RouteGroupBuilder MapShopping(this RouteGroupBuilder api)
    {
        var g = api.MapGroup("/shopping").WithTags("Shopping");

        g.MapGet("/", async (MiseDbContext db) =>
        {
            var items = await db.ShoppingItems.AsNoTracking().Include(s => s.Contributions).ToListAsync();
            var recipesByKey = await ResolveContributionRecipesAsync(db, items);
            var dto = items
                .OrderBy(s => s.Checked)
                .ThenBy(s => s.Category)
                .ThenBy(s => s.Name, Pl.Comparer)
                .Select(s => Mapping.ToDto(s, s.Contributions
                    .Select(c => recipesByKey.GetValueOrDefault(c.SourceKey))
                    .OfType<ShoppingRecipeRefDto>()
                    .DistinctBy(r => r.Id)
                    .ToList()))
                .ToList();
            return Results.Ok(new ShoppingListDto(dto, dto.Count, dto.Count(d => d.Checked)));
        });

        // Empty body toggles (the UI tap); an explicit {"checked": true} is idempotent
        // so agents can safely re-send after a receipt scan.
        g.MapPatch("/{id:guid}/check", async (Guid id, ShoppingCheckInput? input,
            MiseDbContext db, ContextExportService export) =>
        {
            var item = await db.ShoppingItems.Include(s => s.Contributions)
                .FirstOrDefaultAsync(s => s.Id == id);
            if (item is null) return Results.NotFound();
            item.Checked = input?.Checked ?? !item.Checked;
            await db.SaveChangesAsync();
            export.Schedule();
            var recipesByKey = await ResolveContributionRecipesAsync(db, [item]);
            var recipes = item.Contributions
                .Select(c => recipesByKey.GetValueOrDefault(c.SourceKey))
                .OfType<ShoppingRecipeRefDto>()
                .DistinctBy(r => r.Id)
                .ToList();
            return Results.Ok(Mapping.ToDto(item, recipes));
        });

        g.MapPost("/", async (ShoppingItemInput input, MiseDbContext db,
            IngredientMatcher matcher, ContextExportService export) =>
        {
            var name = input.Name?.Trim() ?? "";
            if (name.Length == 0) return Results.BadRequest(new { error = "Podaj nazwę." });
            if (name.Length > 200) return Results.BadRequest(new { error = "Nazwa może mieć maks. 200 znaków." });
            if ((input.Category?.Trim().Length ?? 0) > 60)
                return Results.BadRequest(new { error = "Kategoria może mieć maks. 60 znaków." });
            if ((input.Reason?.Trim().Length ?? 0) > 500)
                return Results.BadRequest(new { error = "Powód może mieć maks. 500 znaków." });
            if (!Mapping.TryParseUnit(input.Unit, out var unit))
                return Results.BadRequest(new { error = "Nieznana jednostka.", allowed = Mapping.AllowedUnits });

            // Best-effort pantry link so a later receipt scan can tie the purchase back.
            var pantry = await db.PantryItems.AsNoTracking().ToListAsync();
            var match = matcher.FindMatch(name, pantry);

            var item = new ShoppingItem
            {
                Name = name,
                Category = string.IsNullOrWhiteSpace(input.Category) ? "Other" : input.Category!.Trim(),
                Reason = string.IsNullOrWhiteSpace(input.Reason) ? "Dodane ręcznie" : input.Reason!.Trim(),
                Origin = ShoppingOrigin.Manual,
                Quantity = input.Quantity is decimal q ? Math.Max(0, q) : null,
                Unit = unit,
                PantryItemId = match?.Id,
            };
            db.ShoppingItems.Add(item);
            await db.SaveChangesAsync();
            export.Schedule();
            return Results.Created($"/api/shopping/{item.Id}", Mapping.ToDto(item));
        });

        g.MapDelete("/{id:guid}", async (Guid id, MiseDbContext db, ContextExportService export) =>
        {
            var item = await db.ShoppingItems.FirstOrDefaultAsync(s => s.Id == id);
            if (item is null) return Results.NotFound();
            db.ShoppingItems.Remove(item);
            await db.SaveChangesAsync();
            export.Schedule();
            return Results.NoContent();
        });

        // Remove all checked-off items.
        g.MapPost("/clear-checked", async (MiseDbContext db, ContextExportService export) =>
        {
            var checkedItems = await db.ShoppingItems.Where(s => s.Checked).ToListAsync();
            if (checkedItems.Count > 0)
            {
                db.ShoppingItems.RemoveRange(checkedItems);
                await db.SaveChangesAsync();
                export.Schedule();
            }
            return Results.Ok(new { removed = checkedItems.Count });
        });

        // Wipe the whole list — the one-tap "start fresh" on the shopping screen.
        g.MapPost("/clear", async (MiseDbContext db, ContextExportService export) =>
        {
            var all = await db.ShoppingItems.ToListAsync();
            if (all.Count > 0)
            {
                db.ShoppingItems.RemoveRange(all);
                await db.SaveChangesAsync();
                export.Schedule();
            }
            return Results.Ok(new { removed = all.Count });
        });

        return api;
    }

    /// <summary>
    /// Maps contribution keys (recipe:{id}, plan:{entryId}) to the recipe they stand
    /// for. Keys of deleted recipes/entries are simply absent.
    /// </summary>
    private static async Task<Dictionary<string, ShoppingRecipeRefDto>> ResolveContributionRecipesAsync(
        MiseDbContext db, List<ShoppingItem> items)
    {
        var keys = items.SelectMany(i => i.Contributions).Select(c => c.SourceKey).Distinct().ToList();
        if (keys.Count == 0) return new Dictionary<string, ShoppingRecipeRefDto>();
        static Guid? IdOf(string key, string prefix) =>
            key.StartsWith(prefix, StringComparison.Ordinal) && Guid.TryParse(key[prefix.Length..], out var id) ? id : null;

        var planIds = keys.Select(k => IdOf(k, "plan:")).OfType<Guid>().ToList();
        var planRecipe = planIds.Count == 0 ? new Dictionary<Guid, Guid>() : await db.PlanEntries.AsNoTracking()
            .Where(e => planIds.Contains(e.Id) && e.RecipeId != null)
            .ToDictionaryAsync(e => e.Id, e => e.RecipeId!.Value);

        var recipeOfKey = new Dictionary<string, Guid>();
        foreach (var key in keys)
        {
            if (IdOf(key, "recipe:") is Guid rid) recipeOfKey[key] = rid;
            else if (IdOf(key, "plan:") is Guid pid && planRecipe.TryGetValue(pid, out var viaPlan)) recipeOfKey[key] = viaPlan;
        }

        var recipeIds = recipeOfKey.Values.Distinct().ToList();
        if (recipeIds.Count == 0) return new Dictionary<string, ShoppingRecipeRefDto>();
        var recipes = await db.Recipes.AsNoTracking()
            .Where(r => recipeIds.Contains(r.Id))
            .Select(r => new { r.Id, r.Title, r.ImagePath })
            .ToDictionaryAsync(r => r.Id);
        return recipeOfKey
            .Where(kv => recipes.ContainsKey(kv.Value))
            .ToDictionary(kv => kv.Key, kv =>
            {
                var r = recipes[kv.Value];
                return new ShoppingRecipeRefDto(r.Id, r.Title, Mapping.ImageUrl(r.ImagePath));
            });
    }
}
