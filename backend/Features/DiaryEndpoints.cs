using Microsoft.EntityFrameworkCore;
using Mise.Api.Data;
using Mise.Api.Domain;
using Mise.Api.Services;

namespace Mise.Api.Features;

/// <summary>
/// The private side of the calendar: pots spread over several days ("W lodówce") and snack
/// favourites. Reads are private too — /api/diary is in ApiAccessMiddleware's private list.
/// Diary entries themselves are plan entries (POST /plan/entries, PATCH /plan/entry/{id}).
/// </summary>
public static class DiaryEndpoints
{
    public static RouteGroupBuilder MapDiary(this RouteGroupBuilder api)
    {
        var g = api.MapGroup("/diary").WithTags("Diary");

        g.MapGet("/fridge", async (DateOnly? today, DiaryService diary) =>
        {
            var day = today ?? DateOnly.FromDateTime(DateTime.Today);
            return Results.Ok((await diary.FridgeAsync(day)).Select(Mapping.ToFridgeDto).ToList());
        });

        g.MapGet("/cooks/{id:guid}", async (Guid id, DiaryService diary) =>
            await diary.LoadCookAsync(id) is { } cook ? Results.Ok(Mapping.ToDto(cook)) : Results.NotFound());

        // "Gotuję na kilka dni": the cook day (new, or FromEntryId) + one leftover per assignment.
        g.MapPost("/cooks", async (CookInput input, DiaryService diary, ContextExportService export) =>
        {
            if (Mapping.TryParseSlot(input.FirstSlot) is not MealSlot firstSlot || ParseAssignments(input.Assignments) is not { } assignments)
                return Results.BadRequest(new { error = "Nieznany posiłek (breakfast/lunch/dinner/snack)." });
            try
            {
                var cook = await diary.CreateCookAsync(input.RecipeId, input.Portions, input.FirstDate, firstSlot,
                    assignments, input.FromEntryId);
                await export.ExportAsync();
                return Results.Ok(Mapping.ToDto((await diary.LoadCookAsync(cook.Id))!));
            }
            catch (DiaryException ex) { return PlanEndpoints.Error(ex); }
        });

        g.MapPut("/cooks/{id:guid}", async (Guid id, CookUpdateInput input, DiaryService diary, ContextExportService export) =>
        {
            if (ParseAssignments(input.Assignments) is not { } assignments)
                return Results.BadRequest(new { error = "Nieznany posiłek (breakfast/lunch/dinner/snack)." });
            try
            {
                await diary.UpdateCookAsync(id, input.Portions, assignments);
                await export.ExportAsync();
                return Results.Ok(Mapping.ToDto((await diary.LoadCookAsync(id))!));
            }
            catch (DiaryException ex) { return PlanEndpoints.Error(ex); }
        });

        g.MapPost("/cooks/{id:guid}/eat", async (Guid id, CookEatInput input, DiaryService diary, ContextExportService export) =>
        {
            if (Mapping.TryParseSlot(input.Slot) is not MealSlot slot)
                return Results.BadRequest(new { error = "Nieznany posiłek (breakfast/lunch/dinner/snack)." });
            try
            {
                var entry = await diary.EatFromCookAsync(id, input.Date, slot);
                await export.ExportAsync();
                return Results.Ok(Mapping.ToDto(entry, cooked: false));
            }
            catch (DiaryException ex) { return PlanEndpoints.Error(ex); }
        });

        g.MapPost("/cooks/{id:guid}/discard", async (Guid id, DiaryService diary) =>
        {
            try
            {
                await diary.DiscardRestAsync(id);
                return Results.NoContent();
            }
            catch (DiaryException ex) { return PlanEndpoints.Error(ex); }
        });

        // Scanned barcode: a product she already logged under this code wins (her own values,
        // her usual grams), otherwise Open Food Facts. Found=false → the UI asks for the label.
        g.MapGet("/barcode/{code}", async (string code, MiseDbContext db, OpenFoodFacts off, PersonScope person) =>
        {
            code = code.Trim();
            if (!OpenFoodFacts.IsBarcode(code)) return Results.BadRequest(new { error = "Kod kreskowy to 8–14 cyfr." });
            // Own product first, then the other person's — the label is the same for both.
            var mine = await db.FoodFavorites.AsNoTracking().Where(f => f.Barcode == code && f.Per100g)
                .OrderByDescending(f => f.PersonId == person.Id).FirstOrDefaultAsync();
            if (mine is not null)
                return Results.Ok(new BarcodeProductDto(code, true, "favorite", mine.Name, null, mine.Kcal, mine.Protein,
                    mine.Fat, mine.Carbs, null, null, mine.LastGrams));
            var p = await off.LookupAsync(code);
            return Results.Ok(p is null
                ? new BarcodeProductDto(code, false, "none", null, null, null, null, null, null, null, null, null)
                : new BarcodeProductDto(code, p.KcalPer100g is not null, "openfoodfacts", p.Name, p.Brand, p.KcalPer100g,
                    p.Protein, p.Fat, p.Carbs, p.ServingGrams, p.ServingLabel, null));
        });

        // Chips for Szybki wpis; all=true is the manage view (hidden ones included, no cap).
        g.MapGet("/favorites", async (bool? all, DiaryService diary) =>
        {
            var everything = all == true;
            var list = await diary.FavoritesAsync(everything, everything ? null : DiaryService.HotCap);
            return Results.Ok(list.Select(Mapping.ToDto).ToList());
        });

        g.MapPost("/favorites", async (FoodFavoriteInput input, DiaryService diary) =>
        {
            try
            {
                var f = await diary.RememberAsync(input.Name, input.Kcal, input.Protein, input.Fat, input.Carbs,
                    input.Per100g, input.LastGrams, input.Barcode);
                return Results.Ok(Mapping.ToDto(f));
            }
            catch (DiaryException ex) { return PlanEndpoints.Error(ex); }
        });

        g.MapPost("/favorites/{id:guid}/log", async (Guid id, FoodFavoriteLogInput input, DiaryService diary, ContextExportService export) =>
        {
            if (Mapping.TryParseSlot(input.Slot) is not MealSlot slot)
                return Results.BadRequest(new { error = "Nieznany posiłek (breakfast/lunch/dinner/snack)." });
            try
            {
                var entry = await diary.LogFavoriteAsync(id, input.Date, slot, input.Grams);
                await export.ExportAsync();
                return Results.Ok(Mapping.ToDto(entry, cooked: false));
            }
            catch (DiaryException ex) { return PlanEndpoints.Error(ex); }
        });

        g.MapPatch("/favorites/{id:guid}", async (Guid id, FoodFavoriteFlagsInput input, MiseDbContext db) =>
        {
            var f = await db.FoodFavorites.FindAsync(id);
            if (f is null) return Results.NotFound();
            if (input.Pinned is bool pinned) f.Pinned = pinned;
            if (input.Hidden is bool hidden) f.Hidden = hidden;
            await db.SaveChangesAsync();
            return Results.Ok(Mapping.ToDto(f));
        });

        return api;
    }

    /// <summary>Null when any slot is unknown.</summary>
    private static List<(DateOnly Date, MealSlot Slot)>? ParseAssignments(List<CookAssignmentInput>? input)
    {
        var result = new List<(DateOnly, MealSlot)>();
        foreach (var a in input ?? [])
        {
            if (Mapping.TryParseSlot(a.Slot) is not MealSlot slot) return null;
            result.Add((a.Date, slot));
        }
        return result;
    }
}
