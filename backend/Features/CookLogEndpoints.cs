using Microsoft.EntityFrameworkCore;
using Mise.Api.Data;
using Mise.Api.Domain;
using Mise.Api.Services;

namespace Mise.Api.Features;

public static class CookLogEndpoints
{
    public static RouteGroupBuilder MapCookLog(this RouteGroupBuilder api)
    {
        var g = api.MapGroup("/cooklog").WithTags("CookLog");

        g.MapGet("/", async (Guid? recipeId, int? limit, MiseDbContext db) =>
        {
            var query = db.CookLog.AsNoTracking().AsQueryable();
            if (recipeId is Guid rid) query = query.Where(e => e.RecipeId == rid);
            var entries = await query
                .OrderByDescending(e => e.CookedAt).ThenByDescending(e => e.CreatedAt)
                .Take(Math.Clamp(limit ?? 50, 1, 500))
                .ToListAsync();
            return Results.Ok(entries.Select(ToDto));
        });

        g.MapPost("/", async (CookLogInput input, MiseDbContext db,
            StockReliability reliability, ContextExportService export) =>
        {
            var dishName = input.DishName?.Trim() ?? "";
            Recipe? recipe = null;
            if (input.RecipeId is Guid rid)
            {
                recipe = await db.Recipes.AsNoTracking().FirstOrDefaultAsync(r => r.Id == rid);
                if (recipe is null) return Results.NotFound(new { error = "Nie ma takiego przepisu." });
                if (dishName.Length == 0) dishName = recipe.Title;
            }
            if (dishName.Length == 0)
                return Results.BadRequest(new { error = "Podaj recipeId albo dishName." });
            if (input.Rating is int rating && rating is < 1 or > 5)
                return Results.BadRequest(new { error = "Ocena musi być w zakresie 1–5." });

            // One transaction: the journal entry and the pantry deductions land together
            // or not at all. Quantities clamp at 0 — cooking can't make stock negative.
            await using var tx = await db.Database.BeginTransactionAsync();

            var deducted = new List<CookDeductedDto>();
            foreach (var d in input.Deductions ?? new())
            {
                var item = await db.PantryItems.FirstOrDefaultAsync(p => p.Id == d.PantryItemId);
                if (item is null)
                    return Results.NotFound(new { error = $"Nie ma pozycji spiżarni {d.PantryItemId}." });
                if (d.Amount <= 0)
                    return Results.BadRequest(new { error = $"Ilość dla '{item.Name}' musi być dodatnia." });
                if (!Mapping.TryParseUnit(d.Unit, out var unit)
                    || (unit is PantryUnit u && u != item.Unit))
                    return Results.BadRequest(new
                    {
                        error = $"Jednostka nie pasuje: '{item.Name}' jest w {Mapping.UnitString(item.Unit)}.",
                        expectedUnit = Mapping.UnitString(item.Unit),
                    });

                var taken = reliability.ApplyCookDeduction(item, d.Amount);
                deducted.Add(new CookDeductedDto(item.Id, item.Name, taken, item.Quantity,
                    Mapping.StatusString(Mapping.StatusOf(item))));
            }

            var entry = new CookLogEntry
            {
                RecipeId = recipe?.Id,
                DishName = dishName,
                Rating = input.Rating,
                Note = input.Note?.Trim() ?? "",
                CookedAt = input.CookedAt ?? DateOnly.FromDateTime(DateTime.Today),
            };
            db.CookLog.Add(entry);
            await db.SaveChangesAsync();
            await tx.CommitAsync();
            await export.ExportAsync();
            return Results.Created($"/api/cooklog/{entry.Id}", new CookLogResultDto(ToDto(entry), deducted));
        });

        // Edits the journal fields only; deductions are POST-only — they already hit
        // the pantry when the entry was created. RecipeId is immutable.
        g.MapPut("/{id:guid}", async (Guid id, CookLogUpdateInput input,
            MiseDbContext db, ContextExportService export) =>
        {
            var entry = await db.CookLog.FirstOrDefaultAsync(e => e.Id == id);
            if (entry is null) return Results.NotFound();
            if (input.Rating is int rating && rating is < 1 or > 5)
                return Results.BadRequest(new { error = "Ocena musi być w zakresie 1–5." });

            var dishName = input.DishName?.Trim();
            if (!string.IsNullOrEmpty(dishName)) entry.DishName = dishName;
            entry.Rating = input.Rating;
            entry.Note = input.Note?.Trim() ?? "";
            if (input.CookedAt is DateOnly cookedAt) entry.CookedAt = cookedAt;

            await db.SaveChangesAsync();
            await export.ExportAsync();
            return Results.Ok(ToDto(entry));
        });

        g.MapDelete("/{id:guid}", async (Guid id, MiseDbContext db, ContextExportService export) =>
        {
            var entry = await db.CookLog.FirstOrDefaultAsync(e => e.Id == id);
            if (entry is null) return Results.NotFound();
            db.CookLog.Remove(entry);
            await db.SaveChangesAsync();
            await export.ExportAsync();
            return Results.NoContent();
        });

        return api;
    }

    private static CookLogEntryDto ToDto(CookLogEntry e) =>
        new(e.Id, e.RecipeId, e.DishName, e.Rating, e.Note, e.CookedAt);
}
