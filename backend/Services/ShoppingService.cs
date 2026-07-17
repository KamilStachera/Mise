using Microsoft.EntityFrameworkCore;
using Mise.Api.Data;
using Mise.Api.Domain;

namespace Mise.Api.Services;

public sealed record ShoppingRecipeSource(string Key, string Label, Recipe Recipe);
public sealed record ShoppingAddResult(int Added, int Updated);

/// <summary>
/// Explicit recipe/plan → shopping-list aggregation. The list remains standalone:
/// pantry changes never create or remove rows by themselves.
/// </summary>
public sealed class ShoppingService
{
    private sealed record ProductKey(Guid? PantryItemId, string NormalizedName);
    private sealed record RowSnapshot(string Name, string Reason, decimal? Quantity,
        PantryUnit? Unit, string Contributions);

    private sealed class Requirement
    {
        public required ShoppingRecipeSource Source { get; init; }
        public required RecipeIngredient Ingredient { get; init; }
        public required ProductKey Key { get; init; }
        public required string ShoppingName { get; init; }
        public PantryItem? PantryItem { get; init; }
    }

    /// <summary>
    /// Adds or refreshes demand from the supplied explicit sources. Requirements are
    /// aggregated before stock is subtracted. Recipe sources are idempotent; distinct
    /// plan-entry keys count as distinct occurrences.
    /// </summary>
    public async Task<ShoppingAddResult> AddMissingForRecipesAsync(MiseDbContext db,
        IEnumerable<ShoppingRecipeSource> recipeSources, CancellationToken ct = default)
    {
        var sources = recipeSources.ToList();
        if (sources.Count == 0) return new(0, 0);

        var sourceKeys = sources.Select(s => s.Key).ToHashSet(StringComparer.Ordinal);
        if (sourceKeys.Count != sources.Count)
            throw new ArgumentException("Shopping source keys must be unique within one operation.", nameof(recipeSources));

        var pantry = await db.PantryItems.AsNoTracking().ToListAsync(ct);
        var pantryById = pantry.ToDictionary(p => p.Id);
        var rows = await db.ShoppingItems
            .Include(s => s.Contributions)
            .Where(s => !s.Checked && s.Origin == ShoppingOrigin.Recipe)
            .ToListAsync(ct);

        // Legacy recipe rows have no contribution provenance. Keep them untouched:
        // guessing their pre-stock demand would make future totals incorrect.
        var managedRows = rows.Where(r => r.Contributions.Count > 0).ToList();
        var snapshots = managedRows.ToDictionary(r => r.Id, Snapshot);
        var affected = new HashSet<ShoppingItem>();
        var staleContributions = new HashSet<ShoppingContribution>();

        // Reprocessing a recipe/plan entry replaces its previous contribution, which
        // makes the action idempotent and lets recipe edits move demand to another row.
        foreach (var row in managedRows)
        {
            var stale = row.Contributions.Where(c => sourceKeys.Contains(c.SourceKey)).ToList();
            if (stale.Count == 0) continue;
            foreach (var contribution in stale)
            {
                row.Contributions.Remove(contribution);
                staleContributions.Add(contribution);
            }
            affected.Add(row);
        }

        var requirements = sources
            .SelectMany(source => source.Recipe.Ingredients.Select(ingredient =>
                CreateRequirement(source, ingredient, pantryById)))
            .Where(r => r is not null)
            .Cast<Requirement>()
            .ToList();

        foreach (var productGroup in requirements.GroupBy(r => r.Key))
        {
            var grouped = productGroup.ToList();
            if (!NeedsPurchase(grouped)) continue;

            var row = FindManagedRow(managedRows, productGroup.Key);
            if (row is null)
            {
                var first = grouped[0];
                row = new ShoppingItem
                {
                    Name = first.ShoppingName,
                    Category = "Recipe",
                    Origin = ShoppingOrigin.Recipe,
                    PantryItemId = first.PantryItem?.Id,
                };
                db.ShoppingItems.Add(row);
                managedRows.Add(row);
            }

            foreach (var sourceGroup in grouped.GroupBy(r => r.Source.Key, StringComparer.Ordinal))
            {
                var sourceRequirements = sourceGroup.ToList();
                var first = sourceGroup.First();
                var sourceUnit = SafeUnit(sourceRequirements);
                var contribution = staleContributions.FirstOrDefault(c =>
                    c.SourceKey == first.Source.Key && c.ShoppingItemId == row.Id);
                if (contribution is null)
                    contribution = new ShoppingContribution();
                else
                    staleContributions.Remove(contribution);

                contribution.SourceKey = first.Source.Key;
                contribution.SourceLabel = first.Source.Label;
                contribution.RequiredQuantity = sourceUnit is PantryUnit
                    ? sourceRequirements.Sum(r => r.Ingredient.AmountValue!.Value)
                    : null;
                contribution.Unit = sourceUnit;
                row.Contributions.Add(contribution);
            }
            affected.Add(row);
        }

        db.ShoppingContributions.RemoveRange(staleContributions);

        var added = 0;
        var updated = 0;
        foreach (var row in affected)
        {
            if (row.Contributions.Count == 0)
            {
                db.ShoppingItems.Remove(row);
                if (snapshots.ContainsKey(row.Id)) updated++;
                continue;
            }

            Recalculate(row, pantryById);
            if (!RowNeedsPurchase(row, pantryById))
            {
                db.ShoppingItems.Remove(row);
                if (snapshots.ContainsKey(row.Id)) updated++;
                continue;
            }
            if (!snapshots.TryGetValue(row.Id, out var before)) added++;
            else if (before != Snapshot(row)) updated++;
        }

        await db.SaveChangesAsync(ct);
        return new(added, updated);
    }

    private static Requirement? CreateRequirement(ShoppingRecipeSource source,
        RecipeIngredient ingredient, IReadOnlyDictionary<Guid, PantryItem> pantryById)
    {
        if (ingredient.PantryItemId is Guid pantryId && pantryById.TryGetValue(pantryId, out var item))
        {
            return new Requirement
            {
                Source = source,
                Ingredient = ingredient,
                Key = new ProductKey(item.Id, ""),
                ShoppingName = item.Name,
                PantryItem = item,
            };
        }

        var normalized = IngredientMatcher.Normalize(ingredient.Name);
        if (normalized.Length == 0) return null;
        return new Requirement
        {
            Source = source,
            Ingredient = ingredient,
            Key = new ProductKey(null, normalized),
            ShoppingName = ingredient.Name.Trim(),
        };
    }

    private static bool NeedsPurchase(IReadOnlyList<Requirement> requirements)
    {
        var pantryItem = requirements[0].PantryItem;
        if (pantryItem is null) return true;

        var unit = SafeUnit(requirements);
        if (unit is null)
        {
            var comparableKnownDemand = requirements
                .Where(r => r.Ingredient.AmountValue is > 0
                    && r.Ingredient.AmountUnit == pantryItem.Unit)
                .Sum(r => r.Ingredient.AmountValue!.Value);
            return pantryItem.Quantity <= 0 || comparableKnownDemand > pantryItem.Quantity;
        }
        var required = requirements.Sum(r => r.Ingredient.AmountValue!.Value);
        return required > pantryItem.Quantity;
    }

    /// <summary>
    /// Returns the one safely summable unit, or null if any amount is unknown,
    /// units differ, or a linked ingredient does not use the pantry item's unit.
    /// </summary>
    private static PantryUnit? SafeUnit(IReadOnlyList<Requirement> requirements)
    {
        PantryUnit? unit = null;
        foreach (var requirement in requirements)
        {
            if (requirement.Ingredient.AmountValue is not > 0
                || requirement.Ingredient.AmountUnit is not PantryUnit current)
                return null;
            if (requirement.PantryItem is PantryItem pantry && current != pantry.Unit)
                return null;
            if (unit is PantryUnit previous && previous != current)
                return null;
            unit = current;
        }
        return unit;
    }

    private static ShoppingItem? FindManagedRow(IEnumerable<ShoppingItem> rows, ProductKey key) =>
        key.PantryItemId is Guid pantryId
            ? rows.FirstOrDefault(r => r.PantryItemId == pantryId)
            : rows.FirstOrDefault(r => r.PantryItemId is null
                && IngredientMatcher.Normalize(r.Name) == key.NormalizedName);

    private static bool RowNeedsPurchase(ShoppingItem row,
        IReadOnlyDictionary<Guid, PantryItem> pantryById)
    {
        if (row.PantryItemId is not Guid id || !pantryById.TryGetValue(id, out var pantry))
            return true;
        if (row.Quantity is decimal quantity) return quantity > 0;
        var knownComparableDemand = row.Contributions
            .Where(c => c.RequiredQuantity is > 0 && c.Unit == pantry.Unit)
            .Sum(c => c.RequiredQuantity!.Value);
        return pantry.Quantity <= 0 || knownComparableDemand > pantry.Quantity;
    }

    private static void Recalculate(ShoppingItem row,
        IReadOnlyDictionary<Guid, PantryItem> pantryById)
    {
        row.Name = row.PantryItemId is Guid pantryId && pantryById.TryGetValue(pantryId, out var pantry)
            ? pantry.Name
            : row.Name;

        var units = row.Contributions.Select(c => c.Unit).Distinct().ToList();
        var safelyNumeric = row.Contributions.All(c => c.RequiredQuantity is > 0 && c.Unit is not null)
            && units.Count == 1;
        if (safelyNumeric)
        {
            var unit = units[0]!.Value;
            var total = row.Contributions.Sum(c => c.RequiredQuantity!.Value);
            var stock = row.PantryItemId is Guid id && pantryById.TryGetValue(id, out var item)
                && item.Unit == unit ? item.Quantity : 0;
            row.Quantity = Math.Max(0, total - stock);
            row.Unit = unit;
        }
        else
        {
            row.Quantity = null;
            row.Unit = null;
        }

        row.Reason = "Do: " + string.Join("; ", row.Contributions
            .GroupBy(c => c.SourceLabel, StringComparer.Ordinal)
            .OrderBy(g => g.Key, Pl.Comparer)
            .Select(g => g.Count() > 1 ? $"{g.Key} ×{g.Count()}" : g.Key));
    }

    private static RowSnapshot Snapshot(ShoppingItem row) => new(
        row.Name, row.Reason, row.Quantity, row.Unit,
        string.Join("|", row.Contributions
            .OrderBy(c => c.SourceKey, StringComparer.Ordinal)
            .Select(c => $"{c.SourceKey}\u001f{c.SourceLabel}\u001f{c.RequiredQuantity}\u001f{c.Unit}")));
}
