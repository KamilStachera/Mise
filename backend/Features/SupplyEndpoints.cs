using Microsoft.EntityFrameworkCore;
using Mise.Api.Data;
using Mise.Api.Services;

namespace Mise.Api.Features;

public static class SupplyEndpoints
{
    public static RouteGroupBuilder MapSupplies(this RouteGroupBuilder api)
    {
        var g = api.MapGroup("/supplies").WithTags("Supplies");

        g.MapGet("/", async (MiseDbContext db, SupplyService supplies) =>
            Results.Ok(await ListAsync(db, supplies)));

        // Hot items on their own, for agents that only want the quick-add vocabulary.
        // ?all=true returns every learned entry, hidden included — what the manage panel
        // needs, since hidden entries are by definition absent from the ranked list.
        g.MapGet("/hot", async (bool? all, SupplyService supplies) =>
        {
            var hot = all == true ? await supplies.AllFavoritesAsync() : await supplies.HotAsync();
            return Results.Ok(hot.Select(Mapping.ToDto).ToList());
        });

        g.MapPost("/", async (SupplyItemInput input, MiseDbContext db, SupplyService supplies,
            ContextExportService export) =>
        {
            if (string.IsNullOrWhiteSpace(input.Name))
                return Results.BadRequest(new { error = "Podaj nazwę." });
            if (!Mapping.TryParseSupplyCategory(input.Category, out var category))
                return Results.BadRequest(new
                {
                    error = "Nieznana kategoria.",
                    allowed = Mapping.AllowedSupplyCategories,
                });

            var before = await db.SupplyItems.CountAsync();
            var item = await supplies.AddAsync(input.Name, category);
            await export.ExportAsync();

            var dto = Mapping.ToDto(item);
            // Re-adding something already on the list is a no-op, so only a genuinely new
            // row reports 201 — an agent retry must not read as "created" twice.
            return await db.SupplyItems.CountAsync() > before
                ? Results.Created($"/api/supplies/{item.Id}", dto)
                : Results.Ok(dto);
        });

        // Empty body toggles (the UI tap); an explicit {"checked": true} is idempotent
        // so agents can safely re-send.
        g.MapPatch("/{id:guid}/check", async (Guid id, SupplyCheckInput? input,
            MiseDbContext db, ContextExportService export) =>
        {
            var item = await db.SupplyItems.FirstOrDefaultAsync(s => s.Id == id);
            if (item is null) return Results.NotFound();
            item.Checked = input?.Checked ?? !item.Checked;
            await db.SaveChangesAsync();
            await export.ExportAsync();
            return Results.Ok(Mapping.ToDto(item));
        });

        g.MapDelete("/{id:guid}", async (Guid id, MiseDbContext db, ContextExportService export) =>
        {
            var item = await db.SupplyItems.FirstOrDefaultAsync(s => s.Id == id);
            if (item is null) return Results.NotFound();
            db.SupplyItems.Remove(item);
            await db.SaveChangesAsync();
            await export.ExportAsync();
            return Results.NoContent();
        });

        // Remove all checked-off items. The SupplyFavorite tallies survive on purpose —
        // that history is what the hot list is computed from.
        g.MapPost("/clear-checked", async (MiseDbContext db, ContextExportService export) =>
        {
            var checkedItems = await db.SupplyItems.Where(s => s.Checked).ToListAsync();
            db.SupplyItems.RemoveRange(checkedItems);
            await db.SaveChangesAsync();
            await export.ExportAsync();
            return Results.Ok(new { removed = checkedItems.Count });
        });

        g.MapPost("/clear", async (MiseDbContext db, ContextExportService export) =>
        {
            var all = await db.SupplyItems.ToListAsync();
            db.SupplyItems.RemoveRange(all);
            await db.SaveChangesAsync();
            await export.ExportAsync();
            return Results.Ok(new { removed = all.Count });
        });

        // Manual override of the learned ranking: pin something that matters, hide
        // something that should never be suggested again.
        g.MapPatch("/hot/{id:guid}", async (Guid id, SupplyFavoriteInput input,
            MiseDbContext db, ContextExportService export) =>
        {
            var favorite = await db.SupplyFavorites.FirstOrDefaultAsync(f => f.Id == id);
            if (favorite is null) return Results.NotFound();
            if (input.Pinned is bool pinned) favorite.Pinned = pinned;
            if (input.Hidden is bool hidden) favorite.Hidden = hidden;
            await db.SaveChangesAsync();
            await export.ExportAsync();
            return Results.Ok(new HotSupplyDto(favorite.Id, favorite.Name,
                Mapping.SupplyCategoryString(favorite.Category), favorite.AddCount,
                favorite.Pinned, favorite.Hidden));
        });

        // Forget a learned entry outright (a typo that got tallied, say).
        g.MapDelete("/hot/{id:guid}", async (Guid id, MiseDbContext db, ContextExportService export) =>
        {
            var favorite = await db.SupplyFavorites.FirstOrDefaultAsync(f => f.Id == id);
            if (favorite is null) return Results.NotFound();
            db.SupplyFavorites.Remove(favorite);
            await db.SaveChangesAsync();
            await export.ExportAsync();
            return Results.NoContent();
        });

        return api;
    }

    private static async Task<SupplyListDto> ListAsync(MiseDbContext db, SupplyService supplies)
    {
        var items = (await db.SupplyItems.AsNoTracking().ToListAsync())
            .OrderBy(s => s.Checked)
            .ThenBy(s => s.Category)
            .ThenBy(s => s.Name, Pl.Comparer)
            .Select(Mapping.ToDto)
            .ToList();
        var hot = (await supplies.HotAsync()).Select(Mapping.ToDto).ToList();
        return new SupplyListDto(items, items.Count, items.Count(d => d.Checked), hot);
    }
}
