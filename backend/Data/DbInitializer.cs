using Microsoft.EntityFrameworkCore;
using Mise.Api.Domain;
using Mise.Api.Services;
using Mise.Api.Services.Training;

namespace Mise.Api.Data;

public static class DbInitializer
{
    public static async Task InitAsync(IServiceProvider services, ILogger logger, CancellationToken ct = default)
    {
        using var scope = services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<MiseDbContext>();
        // Boot passes see every household; per-household work switches the tenant explicitly.
        var tenant = db.Tenant.UseSystem();

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

        await People.ImportLegacyConfigAsync(db, scope.ServiceProvider.GetRequiredService<IConfiguration>(), logger, ct);
        // Insert-only: never touches existing rows, so agent enrichment survives every boot.
        var exercises = await ExerciseImport.EnsureImportedAsync(db, ct);
        if (exercises > 0) logger.LogInformation("Imported {Count} exercises from free-exercise-db", exercises);

        var households = await db.Households.AsNoTracking().OrderBy(h => h.Id).Select(h => h.Id).ToListAsync(ct);
        var matcher = scope.ServiceProvider.GetRequiredService<IngredientMatcher>();
        var export = scope.ServiceProvider.GetRequiredService<ContextExportService>();
        try { export.RemoveLegacyRootFiles(); }
        catch (Exception ex) { logger.LogWarning("Removing the old single-household context files failed: {Message}", ex.Message); }
        foreach (var household in households)
        {
            tenant.UseHousehold(household);
            db.ChangeTracker.Clear();
            await SeedData.EnsureSeededAsync(db, ct);
            await RelinkAndBackfillAsync(db, matcher, ct);
            try
            {
                await export.ExportAsync(ct);
                logger.LogInformation("Context of household {Household} exported to {Dir}", household, export.Directory);
            }
            catch (Exception ex)
            {
                logger.LogWarning("Initial context export of household {Household} failed: {Message}", household, ex.Message);
            }
        }
        tenant.UseSystem();
        db.ChangeTracker.Clear();
    }

    /// <summary>
    /// Idempotent startup passes, run per household (never link one household's recipes to
    /// another's pantry): (1) recompute recipe ingredient links against the household's
    /// pantry catalog, repairing stale fuzzy links as well as links cleared
    /// by a pantry reseed, (2) backfill structured amounts from the display quantity
    /// where it parses ("500 g" → 500/G).
    /// </summary>
    public static async Task RelinkAndBackfillAsync(MiseDbContext db, IngredientMatcher matcher,
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
