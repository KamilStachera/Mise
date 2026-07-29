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
            var logs = await db.CookLog.AsNoTracking()
                .Where(c => c.CookedAt >= from.AddDays(-1) && c.CookedAt <= to.AddDays(1))
                .ToListAsync();
            return Results.Ok(new PlanRangeDto(from, count,
                entries.Select(e => ToDto(e, cooked: PlanShoppingService.IsCooked(e, logs))).ToList()));
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

        // Plan entries from the recent past with no matching cook-log entry — feeds the
        // "did you forget to log this meal?" reminder. A cook-log entry within ±1 day
        // with the same recipe (or the same dish name, case-insensitive) counts as done;
        // the window absorbs "planned Monday, cooked Tuesday" without swallowing a
        // repeat of the same recipe planned a few days later.
        g.MapGet("/pending-cook", async (int? days, MiseDbContext db) =>
        {
            var today = DateOnly.FromDateTime(DateTime.Today);
            var from = today.AddDays(-Math.Clamp(days ?? 14, 1, 60));

            var entries = await db.PlanEntries.AsNoTracking()
                .Include(e => e.Recipe)
                .Where(e => e.Date >= from && e.Date < today && !e.CookReminderDismissed)
                .OrderBy(e => e.Date).ThenBy(e => e.Slot)
                .ToListAsync();
            if (entries.Count == 0) return Results.Ok(new List<PlanEntryDto>());

            var logs = await db.CookLog.AsNoTracking()
                .Where(c => c.CookedAt >= from.AddDays(-1))
                .ToListAsync();

            return Results.Ok(entries
                .Where(e => !PlanShoppingService.IsCooked(e, logs))
                .Select(e => ToDto(e)).ToList());
        });

        // No context export: the dismissed flag is reminder plumbing, not plan content.
        g.MapPost("/entry/{id:guid}/dismiss-cook-reminder", async (Guid id, MiseDbContext db) =>
        {
            var entry = await db.PlanEntries.FirstOrDefaultAsync(e => e.Id == id);
            if (entry is null) return Results.NotFound();
            entry.CookReminderDismissed = true;
            entry.UpdatedAt = DateTimeOffset.UtcNow;
            await db.SaveChangesAsync();
            return Results.NoContent();
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

        g.MapGet("/shopping-preview", async (DateOnly? start, int? days,
            MiseDbContext db, ShoppingService shopping) =>
        {
            var from = start ?? StartOfWeek(DateOnly.FromDateTime(DateTime.Today));
            var count = Math.Clamp(days ?? 7, 1, 60);
            var selection = await PlanShoppingService.LoadAsync(db, from, count);
            return Results.Ok(await shopping.PreviewAsync(db, selection.Sources, from, count));
        });

        // Add every planned recipe's out-of-stock / unmatched ingredients to the shopping list.
        g.MapPost("/add-missing-to-shopping", async (PlanAddMissingInput input, MiseDbContext db,
            ShoppingService shopping, StockReliability reliability, ContextExportService export) =>
        {
            var from = input.Start ?? StartOfWeek(DateOnly.FromDateTime(DateTime.Today));
            var count = Math.Clamp(input.Days ?? 7, 1, 60);
            await using var tx = await db.Database.BeginTransactionAsync();
            foreach (var confirmation in (input.Confirmations ?? new())
                .GroupBy(c => c.PantryItemId).Select(g => g.Last()))
            {
                if (confirmation.Quantity < 0)
                    return Results.BadRequest(new { error = "Potwierdzona ilość nie może być ujemna." });
                var item = await db.PantryItems.FirstOrDefaultAsync(p => p.Id == confirmation.PantryItemId);
                if (item is null)
                    return Results.NotFound(new { error = $"Nie ma pozycji spiżarni {confirmation.PantryItemId}." });
                reliability.Confirm(item, confirmation.Quantity);
            }

            if ((input.Confirmations?.Count ?? 0) > 0)
                await db.SaveChangesAsync();
            var selection = await PlanShoppingService.LoadAsync(db, from, count);
            var result = await shopping.AddMissingForRecipesAsync(
                db, selection.Sources, selection.ScopeKeys);
            await tx.CommitAsync();
            if (result.Added > 0 || result.Updated > 0 || (input.Confirmations?.Count ?? 0) > 0)
                await export.ExportAsync();
            return Results.Ok(new ShoppingAddResultDto(result.Added, result.Updated));
        });

        return api;
    }

    public static DateOnly StartOfWeek(DateOnly date)
    {
        // Monday-based week, matching the UI's Pon–Nie grid.
        var diff = ((int)date.DayOfWeek + 6) % 7;
        return date.AddDays(-diff);
    }

    private static PlanEntryDto ToDto(PlanEntry e, string? recipeTitle = null, bool cooked = false) =>
        new(e.Id, e.Date, Mapping.SlotString(e.Slot), e.RecipeId,
            e.Recipe?.Title ?? recipeTitle, e.Title, e.Note, cooked);
}
