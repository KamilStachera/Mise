using Microsoft.EntityFrameworkCore;
using Mise.Api.Domain;
using Mise.Api.Services;

namespace Mise.Api.Data;

public static class DbInitializer
{
    public static async Task InitAsync(IServiceProvider services, ILogger logger, CancellationToken ct = default)
    {
        using var scope = services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<MiseDbContext>();

        for (var attempt = 1; ; attempt++)
        {
            try
            {
                await db.Database.MigrateAsync(ct);
                break;
            }
            catch (Exception ex) when (attempt < 15)
            {
                logger.LogWarning("Database not ready (attempt {Attempt}): {Message}", attempt, ex.Message);
                await Task.Delay(2000, ct);
            }
        }

        await SeedData.EnsureSeededAsync(db, ct);
        await RelinkAndBackfillAsync(db, scope.ServiceProvider.GetRequiredService<IngredientMatcher>(), ct);

        try
        {
            var export = scope.ServiceProvider.GetRequiredService<ContextExportService>();
            await export.ExportAsync(ct);
            logger.LogInformation("Context exported to {Dir}", export.Directory);
        }
        catch (Exception ex)
        {
            logger.LogWarning("Initial context export failed: {Message}", ex.Message);
        }
    }

    /// <summary>
    /// Idempotent startup passes: (1) relink recipe ingredients to pantry items after
    /// a pantry reseed (the fresh-start migration nulls all links), (2) backfill
    /// structured amounts from the display quantity where it parses ("500 g" → 500/G).
    /// </summary>
    private static async Task RelinkAndBackfillAsync(MiseDbContext db, IngredientMatcher matcher,
        CancellationToken ct)
    {
        var ingredients = await db.RecipeIngredients
            .Where(i => i.PantryItemId == null || (i.AmountValue == null && i.Quantity != ""))
            .ToListAsync(ct);
        if (ingredients.Count == 0) return;

        var pantry = await db.PantryItems.AsNoTracking().ToListAsync(ct);
        foreach (var ing in ingredients)
        {
            if (ing.PantryItemId is null && matcher.FindMatch(ing.Name, pantry) is PantryItem hit)
                ing.PantryItemId = hit.Id;
            if (ing.AmountValue is null && QuantityParser.TryParse(ing.Quantity, out var v, out var u))
            {
                ing.AmountValue = v;
                ing.AmountUnit = u;
            }
        }
        await db.SaveChangesAsync(ct);
    }
}
