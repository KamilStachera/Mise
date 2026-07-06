using Microsoft.EntityFrameworkCore;
using Mise.Api.Data;
using Mise.Api.Domain;
using Mise.Api.Services;

namespace Mise.Api.Features;

public static class PlanEndpoints
{
    public static RouteGroupBuilder MapPlan(this RouteGroupBuilder api)
    {
        var g = api.MapGroup("/plan").WithTags("Plan");

        g.MapGet("/", async (DateOnly? start, int? days, MiseDbContext db) =>
        {
            var from = start ?? StartOfWeek(DateOnly.FromDateTime(DateTime.Today));
            var count = Math.Clamp(days ?? 14, 1, 60);
            var to = from.AddDays(count);

            var entries = await db.PlanEntries.AsNoTracking()
                .Include(e => e.Recipe)
                .Where(e => e.Date >= from && e.Date < to)
                .OrderBy(e => e.Date).ThenBy(e => e.Slot)
                .ToListAsync();
            return Results.Ok(new PlanRangeDto(from, count, entries.Select(e => ToDto(e)).ToList()));
        });

        // Upsert on (date, slot) so agents and the UI can write idempotently.
        g.MapPut("/entry", async (PlanEntryInput input, MiseDbContext db, ContextExportService export) =>
        {
            var slot = Mapping.ParseSlot(input.Slot);
            var title = input.Title?.Trim() ?? "";
            Recipe? recipe = null;
            if (input.RecipeId is Guid rid)
            {
                recipe = await db.Recipes.AsNoTracking().FirstOrDefaultAsync(r => r.Id == rid);
                if (recipe is null) return Results.NotFound(new { error = "Nie ma takiego przepisu." });
            }
            if (recipe is null && title.Length == 0)
                return Results.BadRequest(new { error = "Podaj recipeId albo title." });

            var entry = await db.PlanEntries.FirstOrDefaultAsync(e => e.Date == input.Date && e.Slot == slot);
            if (entry is null)
            {
                entry = new PlanEntry { Date = input.Date, Slot = slot };
                db.PlanEntries.Add(entry);
            }
            entry.RecipeId = recipe?.Id;
            entry.Title = title;
            entry.Note = input.Note?.Trim() ?? "";
            entry.UpdatedAt = DateTimeOffset.UtcNow;
            await db.SaveChangesAsync();
            await export.ExportAsync();
            return Results.Ok(ToDto(entry, recipe?.Title));
        });

        g.MapDelete("/entry/{id:guid}", async (Guid id, MiseDbContext db, ContextExportService export) =>
        {
            var entry = await db.PlanEntries.FirstOrDefaultAsync(e => e.Id == id);
            if (entry is null) return Results.NotFound();
            db.PlanEntries.Remove(entry);
            await db.SaveChangesAsync();
            await export.ExportAsync();
            return Results.NoContent();
        });

        // Add every planned recipe's out-of-stock / unmatched ingredients to the shopping list.
        g.MapPost("/add-missing-to-shopping", async (PlanRangeInput input, MiseDbContext db,
            ShoppingService shopping, ContextExportService export) =>
        {
            var from = input.Start ?? StartOfWeek(DateOnly.FromDateTime(DateTime.Today));
            var to = from.AddDays(Math.Clamp(input.Days ?? 7, 1, 60));

            var recipeIds = await db.PlanEntries.AsNoTracking()
                .Where(e => e.Date >= from && e.Date < to && e.RecipeId != null)
                .Select(e => e.RecipeId!.Value)
                .Distinct()
                .ToListAsync();
            var recipes = await db.Recipes.AsNoTracking()
                .Include(r => r.Ingredients)
                .Where(r => recipeIds.Contains(r.Id))
                .ToListAsync();

            var added = await shopping.AddMissingForRecipesAsync(db, recipes);
            if (added > 0) await export.ExportAsync();
            return Results.Ok(new { added });
        });

        return api;
    }

    public static DateOnly StartOfWeek(DateOnly date)
    {
        // Monday-based week, matching the UI's Pon–Nie grid.
        var diff = ((int)date.DayOfWeek + 6) % 7;
        return date.AddDays(-diff);
    }

    private static PlanEntryDto ToDto(PlanEntry e, string? recipeTitle = null) =>
        new(e.Id, e.Date, Mapping.SlotString(e.Slot), e.RecipeId,
            e.Recipe?.Title ?? recipeTitle, e.Title, e.Note);
}
