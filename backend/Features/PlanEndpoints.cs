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

        // One person's calendar (X-Person / own login; anonymous = person 1, the household cook).
        // Anonymous visitors get the meal plan only: snacks, typed food and eaten state are
        // the private diary (see Mapping.PublicView).
        g.MapGet("/", async (DateOnly? start, int? days, MiseDbContext db, HttpContext ctx, AccessControl access,
            PersonScope person, CateringService catering) =>
        {
            var today = DateOnly.FromDateTime(DateTime.Today);
            var from = start ?? StartOfWeek(today);
            var count = Math.Clamp(days ?? 14, 1, 60);
            var to = from.AddDays(count);
            var privileged = access.IsPrivileged(ctx);
            if (privileged) await catering.EnsureAsync(today);

            var entries = await db.PlanEntries.AsNoTracking()
                .Include(e => e.Recipe)
                .Include(e => e.Cook)
                .Where(e => e.PersonId == person.Id && e.Date >= from && e.Date < to)
                .OrderBy(e => e.Date).ThenBy(e => e.Slot).ThenBy(e => e.CreatedAt)
                .ToListAsync();
            // Leftovers are matched on their pot's cook day, which can sit before the range.
            var logs = await db.CookLog.AsNoTracking()
                .Where(c => c.CookedAt >= from.AddDays(-(DiaryService.FridgeDays + 1)) && c.CookedAt <= to.AddDays(1))
                .ToListAsync();

            var dtos = entries
                .Where(e => privileged || (e.Slot != MealSlot.Snack && (e.RecipeId is not null || e.Kcal is null)))
                .Select(e => Mapping.ToDto(e, cooked: PlanShoppingService.IsCooked(e, logs)))
                .Select(d => privileged ? d : Mapping.PublicView(d))
                .ToList();
            return Results.Ok(new PlanRangeDto(from, count, dtos));
        });

        // Upsert onto the slot's first plain planned meal so agents can write idempotently;
        // eaten food, leftovers and pots in the same slot are left alone.
        g.MapPut("/entry", async (PlanEntryInput input, MiseDbContext db, PersonScope person, ContextExportService export) =>
        {
            var slot = Mapping.ParseSlot(input.Slot);
            var title = input.Title?.Trim() ?? "";
            Recipe? recipe = null;
            if (input.RecipeId is Guid rid)
            {
                recipe = await db.Recipes.FirstOrDefaultAsync(r => r.Id == rid);
                if (recipe is null) return Results.NotFound(new { error = "Nie ma takiego przepisu." });
            }
            if (recipe is null && title.Length == 0)
                return Results.BadRequest(new { error = "Podaj recipeId albo title." });

            var entry = await db.PlanEntries
                .Where(e => e.PersonId == person.Id && e.Date == input.Date && e.Slot == slot && e.EatenAt == null
                    && e.CookId == null && !e.IsCatering)
                .OrderBy(e => e.CreatedAt)
                .FirstOrDefaultAsync();
            if (entry is null)
            {
                entry = new PlanEntry { PersonId = person.Id, Date = input.Date, Slot = slot };
                db.PlanEntries.Add(entry);
            }
            entry.RecipeId = recipe?.Id;
            entry.Recipe = recipe;
            entry.Title = recipe is null ? title : "";
            entry.Note = input.Note?.Trim() ?? "";
            entry.UpdatedAt = DateTimeOffset.UtcNow;
            await db.SaveChangesAsync();
            await export.ExportAsync();
            return Results.Ok(Mapping.ToDto(entry, cooked: false));
        });

        // Always adds (several items per slot): diary food, a saved recipe with a portion size,
        // or a typed meal. Favorite also remembers it as an "Ulubione" chip.
        g.MapPost("/entries", async (DiaryEntryInput input, DiaryService diary, ContextExportService export) =>
        {
            if (Mapping.TryParseSlot(input.Slot) is not MealSlot slot)
                return Results.BadRequest(new { error = "Nieznany posiłek (breakfast/lunch/dinner/snack)." });
            try
            {
                var entry = await diary.AddEntryAsync(input.Date, slot, input.RecipeId, input.Title, input.Note,
                    input.Portions, input.Grams, input.Kcal, input.Protein, input.Fat, input.Carbs, input.Eaten);
                if (input.Favorite is { } f)
                    await diary.RememberAsync(f.Name, f.Kcal, f.Protein, f.Fat, f.Carbs, f.Per100g, f.LastGrams, f.Barcode);
                await export.ExportAsync();
                return Results.Ok(Mapping.ToDto(entry, cooked: false));
            }
            catch (DiaryException ex) { return Error(ex); }
        });

        g.MapPatch("/entry/{id:guid}", async (Guid id, PlanEntryPatch input, MiseDbContext db, ContextExportService export) =>
        {
            var entry = await db.PlanEntries.Include(e => e.Recipe).Include(e => e.Cook)
                .FirstOrDefaultAsync(e => e.Id == id);
            if (entry is null) return Results.NotFound();

            if (input.Slot is not null)
            {
                if (Mapping.TryParseSlot(input.Slot) is not MealSlot slot)
                    return Results.BadRequest(new { error = "Nieznany posiłek (breakfast/lunch/dinner/snack)." });
                entry.Slot = slot;
            }
            if (input.Date is DateOnly date)
            {
                entry.Date = date;
                if (entry.Cook is not null && !entry.IsLeftover) entry.Cook.Date = date;
            }
            if (input.Note is not null) entry.Note = input.Note.Trim();
            var portionsChanged = false;
            if (entry.RecipeId is not null)
            {
                if (input.Portions is decimal p)
                {
                    var clamped = DiaryService.ClampPortions(p);
                    portionsChanged = clamped != entry.Portions;
                    entry.Portions = clamped;
                }
            }
            else
            {
                if (input.Title is { } t && t.Trim().Length > 0) entry.Title = t.Trim();
                if (input.Kcal is int kcal)
                {
                    if (kcal is < 0 or > 10000) return Results.BadRequest(new { error = "Kcal poza zakresem." });
                    entry.Kcal = kcal;
                }
                if (input.Protein is not null) entry.Protein = input.Protein;
                if (input.Fat is not null) entry.Fat = input.Fat;
                if (input.Carbs is not null) entry.Carbs = input.Carbs;
                if (input.Grams is not null) entry.Grams = input.Grams > 0 ? input.Grams : null;
            }
            if (input.Eaten is bool eaten && eaten != (entry.EatenAt is not null)) DiaryService.SetEaten(entry, eaten);
            else if (portionsChanged) DiaryService.Snapshot(entry);
            entry.UpdatedAt = DateTimeOffset.UtcNow;
            await db.SaveChangesAsync();
            await export.ExportAsync();
            return Results.Ok(Mapping.ToDto(entry, cooked: false));
        });

        // Plan entries from the recent past with no matching cook-log entry — feeds the
        // "did you forget to log this meal?" reminder. A cook-log entry within ±1 day
        // with the same recipe (or the same dish name, case-insensitive) counts as done;
        // the window absorbs "planned Monday, cooked Tuesday" without swallowing a
        // repeat of the same recipe planned a few days later. Leftovers and snack logs
        // are not cooking, so they never ask.
        g.MapGet("/pending-cook", async (int? days, MiseDbContext db) =>
        {
            var today = DateOnly.FromDateTime(DateTime.Today);
            var from = today.AddDays(-Math.Clamp(days ?? 14, 1, 60));

            var entries = (await db.PlanEntries.AsNoTracking()
                .Include(e => e.Recipe)
                .Include(e => e.Cook)
                .Where(e => e.Date >= from && e.Date < today && !e.CookReminderDismissed)
                .OrderBy(e => e.Date).ThenBy(e => e.Slot)
                .ToListAsync())
                .Where(PlanShoppingService.IsCookable)
                .ToList();
            if (entries.Count == 0) return Results.Ok(new List<PlanEntryDto>());

            var logs = await db.CookLog.AsNoTracking()
                .Where(c => c.CookedAt >= from.AddDays(-1))
                .ToListAsync();

            return Results.Ok(entries
                .Where(e => !PlanShoppingService.IsCooked(e, logs))
                .Select(e => Mapping.ToDto(e, cooked: false)).ToList());
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

        // Deleting a pot's cook day drops the whole pot (planned leftovers included).
        g.MapDelete("/entry/{id:guid}", async (Guid id, DiaryService diary, ContextExportService export) =>
        {
            if (!await diary.DeleteEntryAsync(id)) return Results.NotFound();
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

    internal static IResult Error(DiaryException ex) => Results.Json(new { error = ex.Message }, statusCode: ex.Status);
}
