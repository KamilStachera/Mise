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
            var items = await db.ShoppingItems.AsNoTracking().ToListAsync();
            var dto = items
                .OrderBy(s => s.Checked)
                .ThenBy(s => s.Category)
                .ThenBy(s => s.Name, Pl.Comparer)
                .Select(Mapping.ToDto)
                .ToList();
            return Results.Ok(new ShoppingListDto(dto, dto.Count, dto.Count(d => d.Checked)));
        });

        // Empty body toggles (the UI tap); an explicit {"checked": true} is idempotent
        // so agents can safely re-send after a receipt scan.
        g.MapPatch("/{id:guid}/check", async (Guid id, ShoppingCheckInput? input,
            MiseDbContext db, ContextExportService export) =>
        {
            var item = await db.ShoppingItems.FirstOrDefaultAsync(s => s.Id == id);
            if (item is null) return Results.NotFound();
            item.Checked = input?.Checked ?? !item.Checked;
            await db.SaveChangesAsync();
            await export.ExportAsync();
            return Results.Ok(Mapping.ToDto(item));
        });

        g.MapPost("/", async (ShoppingItemInput input, MiseDbContext db,
            IngredientMatcher matcher, ContextExportService export) =>
        {
            if (string.IsNullOrWhiteSpace(input.Name)) return Results.BadRequest();
            if (!Mapping.TryParseUnit(input.Unit, out var unit))
                return Results.BadRequest(new { error = "Nieznana jednostka.", allowed = Mapping.AllowedUnits });

            // Best-effort pantry link so a later receipt scan can tie the purchase back.
            var pantry = await db.PantryItems.AsNoTracking().ToListAsync();
            var match = matcher.FindMatch(input.Name, pantry);

            var item = new ShoppingItem
            {
                Name = input.Name.Trim(),
                Category = string.IsNullOrWhiteSpace(input.Category) ? "Other" : input.Category!.Trim(),
                Reason = string.IsNullOrWhiteSpace(input.Reason) ? "Dodane ręcznie" : input.Reason!.Trim(),
                Origin = ShoppingOrigin.Manual,
                Quantity = input.Quantity is decimal q ? Math.Max(0, q) : null,
                Unit = unit,
                PantryItemId = match?.Id,
            };
            db.ShoppingItems.Add(item);
            await db.SaveChangesAsync();
            await export.ExportAsync();
            return Results.Created($"/api/shopping/{item.Id}", Mapping.ToDto(item));
        });

        g.MapDelete("/{id:guid}", async (Guid id, MiseDbContext db, ContextExportService export) =>
        {
            var item = await db.ShoppingItems.FirstOrDefaultAsync(s => s.Id == id);
            if (item is null) return Results.NotFound();
            db.ShoppingItems.Remove(item);
            await db.SaveChangesAsync();
            await export.ExportAsync();
            return Results.NoContent();
        });

        // Remove all checked-off items.
        g.MapPost("/clear-checked", async (MiseDbContext db, ContextExportService export) =>
        {
            var checkedItems = await db.ShoppingItems.Where(s => s.Checked).ToListAsync();
            db.ShoppingItems.RemoveRange(checkedItems);
            await db.SaveChangesAsync();
            await export.ExportAsync();
            return Results.Ok(new { removed = checkedItems.Count });
        });

        // Wipe the whole list — the one-tap "start fresh" on the shopping screen.
        g.MapPost("/clear", async (MiseDbContext db, ContextExportService export) =>
        {
            var all = await db.ShoppingItems.ToListAsync();
            db.ShoppingItems.RemoveRange(all);
            await db.SaveChangesAsync();
            await export.ExportAsync();
            return Results.Ok(new { removed = all.Count });
        });

        return api;
    }
}
