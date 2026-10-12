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

        await scope.ServiceProvider.GetRequiredService<People>().SyncAsync(db, ct);
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
    /// Idempotent startup passes: (1) recompute recipe ingredient links against the
    /// current pantry catalog, repairing stale fuzzy links as well as links cleared
    /// by a pantry reseed, (2) backfill structured amounts from the display quantity
    /// where it parses ("500 g" → 500/G).
    /// </summary>
    private static async Task RelinkAndBackfillAsync(MiseDbContext db, IngredientMatcher matcher,
        CancellationToken ct)
    {
        var ingredients = await db.RecipeIngredients.ToListAsync(ct);
        if (ingredients.Count == 0) return;

        var pantry = await db.PantryItems.AsNoTracking().ToListAsync(ct);
        matcher.RelinkIngredients(ingredients, pantry);
        foreach (var ing in ingredients)
        {
            if (ing.AmountValue is null && QuantityParser.TryParse(ing.Quantity, out var v, out var u))
            {
                ing.AmountValue = v;
                ing.AmountUnit = u;
            }
        }
        await db.SaveChangesAsync(ct);
    }
}
