using Microsoft.EntityFrameworkCore;
using Mise.Api.Data;
using Mise.Api.Domain;
using Mise.Api.Features;

namespace Mise.Api.Services;

public sealed record ShoppingRecipeSource(string Key, string Label, Recipe Recipe);
public sealed record ShoppingAddResult(int Added, int Updated);

/// <summary>
/// Explicit recipe/plan to shopping-list aggregation. The list remains standalone:
/// pantry changes never create or remove rows by themselves.
/// </summary>
public sealed class ShoppingService
{
    private sealed record ProductKey(Guid? PantryItemId, string NormalizedName);
    private sealed record RowSnapshot(string Name, string Reason, decimal? Quantity,
        PantryUnit? Unit, string? AlternativeKey, string? AlternativePantryItemIds,
        string Contributions);

    private sealed class Requirement
    {
        public required ShoppingRecipeSource Source { get; init; }
        public required RecipeIngredient Ingredient { get; init; }
        public required ProductKey Key { get; init; }
        public required string ShoppingName { get; init; }
        public PantryItem? PantryItem { get; init; }
    }

    private sealed class AlternativeRequirement
    {
        public required ShoppingRecipeSource Source { get; init; }
        public required string Key { get; init; }
        public required string ShoppingName { get; init; }
        public required IReadOnlyList<RecipeIngredient> Options { get; init; }
        public required IReadOnlyList<PantryItem> PantryItems { get; init; }
    }

    /// <summary>
    /// Adds or refreshes demand from the supplied explicit sources. When
    /// <paramref name="sourceKeysToReplace"/> is supplied, existing contributions for
    /// that whole scope are replaced even when a source is absent from the new demand.
    /// Requirements are aggregated before stock is subtracted. Recipe sources are
    /// idempotent; distinct plan-entry keys count as distinct occurrences.
    /// </summary>
    public async Task<ShoppingAddResult> AddMissingForRecipesAsync(MiseDbContext db,
        IEnumerable<ShoppingRecipeSource> recipeSources,
        IEnumerable<string>? sourceKeysToReplace = null,
        CancellationToken ct = default)
    {
        var sources = recipeSources.ToList();
        var sourceKeys = sources.Select(s => s.Key).ToHashSet(StringComparer.Ordinal);
        if (sourceKeys.Count != sources.Count)
            throw new ArgumentException("Shopping source keys must be unique within one operation.", nameof(recipeSources));
        var replacementKeys = (sourceKeysToReplace ?? sourceKeys).ToHashSet(StringComparer.Ordinal);
        if (!sourceKeys.IsSubsetOf(replacementKeys))
            throw new ArgumentException("Replacement scope must contain every supplied source key.",
                nameof(sourceKeysToReplace));
        if (replacementKeys.Count == 0) return new(0, 0);

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
            var stale = row.Contributions.Where(c => replacementKeys.Contains(c.SourceKey)).ToList();
            if (stale.Count == 0) continue;
            foreach (var contribution in stale)
            {
                row.Contributions.Remove(contribution);
                staleContributions.Add(contribution);
            }
            affected.Add(row);
        }

        var sourceRequirementGroups = sources.SelectMany(source =>
            Mapping.IngredientRequirementGroups(source.Recipe.Ingredients)
                .Select(group => (Source: source, Group: group))).ToList();
        var requirements = sourceRequirementGroups
            .Where(x => x.Group.Count == 1
                && string.IsNullOrWhiteSpace(x.Group[0].AlternativeGroup))
            .Select(x => CreateRequirement(x.Source, x.Group[0], pantryById))
            .Where(r => r is not null)
            .Cast<Requirement>()
            .ToList();
        var alternativeRequirements = sourceRequirementGroups
            .Where(x => !string.IsNullOrWhiteSpace(x.Group[0].AlternativeGroup))
            .Select(x => CreateAlternativeRequirement(x.Source, x.Group, pantryById))
            .Where(r => r is not null)
            .Cast<AlternativeRequirement>()
            .ToList();

        AddOrdinaryRequirements(db, requirements, pantryById, managedRows,
            affected, staleContributions);
        AddAlternativeRequirements(db, alternativeRequirements, managedRows,
            affected, staleContributions);

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

    /// <summary>
    /// Read-only comparison of best-estimate and conservative shopping outcomes.
    /// A row needs confirmation only when that uncertainty changes the decision.
    /// </summary>
    public async Task<ShoppingPreviewDto> PreviewAsync(MiseDbContext db,
        IEnumerable<ShoppingRecipeSource> recipeSources, DateOnly start, int days,
        CancellationToken ct = default)
    {
        var sources = recipeSources.ToList();
        var pantry = await db.PantryItems.AsNoTracking().ToListAsync(ct);
        var pantryById = pantry.ToDictionary(p => p.Id);
        var sourceRequirementGroups = sources.SelectMany(source =>
            Mapping.IngredientRequirementGroups(source.Recipe.Ingredients)
                .Select(group => (Source: source, Group: group))).ToList();
        var requirements = sourceRequirementGroups
            .Where(x => x.Group.Count == 1 && string.IsNullOrWhiteSpace(x.Group[0].AlternativeGroup))
            .Select(x => CreateRequirement(x.Source, x.Group[0], pantryById))
            .Where(r => r is not null).Cast<Requirement>().ToList();
        var alternatives = sourceRequirementGroups
            .Where(x => !string.IsNullOrWhiteSpace(x.Group[0].AlternativeGroup))
            .Select(x => CreateAlternativeRequirement(x.Source, x.Group, pantryById))
            .Where(r => r is not null).Cast<AlternativeRequirement>().ToList();

        var items = new List<ShoppingPreviewItemDto>();
        foreach (var productGroup in requirements.GroupBy(r => r.Key))
        {
            var grouped = productGroup.ToList();
            var pantryItem = grouped[0].PantryItem;
            var unit = SafeUnit(grouped);
            decimal? required = unit is not null
                ? grouped.Sum(r => r.Ingredient.AmountValue!.Value) : null;
            var estimated = pantryItem?.Quantity;
            decimal? planning = pantryItem is null ? null : StockReliability.PlanningQuantity(pantryItem);
            decimal? estimatedPurchase = required is decimal demand
                ? Math.Max(0, demand - (estimated ?? 0)) : null;
            decimal? suggestedPurchase = required is decimal safeDemand
                ? Math.Max(0, safeDemand - (planning ?? 0)) : null;
            var needsConfirmation = pantryItem is not null && (required is not null
                ? estimatedPurchase != suggestedPurchase
                : (estimated > 0) != (planning > 0));
            items.Add(new ShoppingPreviewItemDto(
                productGroup.Key.PantryItemId?.ToString() ?? productGroup.Key.NormalizedName,
                pantryItem?.Id,
                grouped[0].ShoppingName,
                required,
                unit is PantryUnit u ? Mapping.UnitString(u) : null,
                estimated,
                planning,
                estimatedPurchase,
                suggestedPurchase,
                pantryItem is null ? "unknown" : StockReliability.Confidence(pantryItem),
                needsConfirmation,
                grouped.Select(r => r.Source.Label).Distinct().OrderBy(x => x, Pl.Comparer).ToList()));
        }

        foreach (var alternativeGroup in alternatives.GroupBy(r => r.Key, StringComparer.Ordinal))
        {
            var grouped = alternativeGroup.ToList();
            var pantryItems = grouped.SelectMany(r => r.PantryItems).DistinctBy(p => p.Id).ToList();
            var safeAmounts = grouped.Select(SafeAlternativeAmount).ToList();
            var numeric = safeAmounts.All(x => x.RequiredQuantity is > 0 && x.Unit is not null)
                && safeAmounts.Select(x => x.Unit).Distinct().Count() == 1;
            var estimatedEnough = numeric
                ? CanSatisfyAlternativeDemandsUsing(
                    safeAmounts.Select(x => x.RequiredQuantity!.Value), pantryItems,
                    safeAmounts[0].Unit!.Value, p => p.Quantity)
                : pantryItems.Any(p => p.Quantity > 0);
            var planningEnough = numeric
                ? CanSatisfyAlternativeDemands(
                    safeAmounts.Select(x => x.RequiredQuantity!.Value), pantryItems,
                    safeAmounts[0].Unit!.Value)
                : pantryItems.Any(p => StockReliability.PlanningQuantity(p) > 0);
            var confidence = pantryItems.Count == 0 ? "unknown"
                : pantryItems.Any(p => StockReliability.Confidence(p) == "stale") ? "stale"
                : pantryItems.Any(p => StockReliability.Confidence(p) == "estimated") ? "estimated"
                : "confirmed";
            items.Add(new ShoppingPreviewItemDto(
                $"alternative:{alternativeGroup.Key}", null, grouped[0].ShoppingName,
                numeric ? safeAmounts.Sum(x => x.RequiredQuantity!.Value) : null,
                numeric ? Mapping.UnitString(safeAmounts[0].Unit!.Value) : null,
                null, null, estimatedEnough ? 0 : null, planningEnough ? 0 : null,
                confidence, estimatedEnough != planningEnough,
                grouped.Select(r => r.Source.Label).Distinct().OrderBy(x => x, Pl.Comparer).ToList(),
                pantryItems.Select(p => p.Id).ToList()));
        }

        return new ShoppingPreviewDto(start, days,
            items.OrderBy(i => i.Name, Pl.Comparer).ToList());
    }

    private static void AddOrdinaryRequirements(MiseDbContext db,
        IReadOnlyList<Requirement> requirements,
        IReadOnlyDictionary<Guid, PantryItem> pantryById,
        List<ShoppingItem> managedRows, HashSet<ShoppingItem> affected,
        HashSet<ShoppingContribution> staleContributions)
    {
        foreach (var productGroup in requirements.GroupBy(r => r.Key))
        {
            var grouped = productGroup.ToList();
            var row = FindManagedRow(managedRows, productGroup.Key);
            if (!NeedsPurchase(grouped, row)) continue;

            if (row is null)
            {
                var first = grouped[0];
                row = new ShoppingItem
                {
                    Name = Truncate(first.ShoppingName, 200),
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
                var first = sourceRequirements[0];
                var sourceUnit = SafeUnit(sourceRequirements);
                var contribution = TakeStaleContribution(staleContributions, first.Source.Key, row.Id)
                    ?? NewContribution(db);
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
    }

    private static void AddAlternativeRequirements(MiseDbContext db,
        IReadOnlyList<AlternativeRequirement> requirements,
        List<ShoppingItem> managedRows, HashSet<ShoppingItem> affected,
        HashSet<ShoppingContribution> staleContributions)
    {
        foreach (var alternativeGroup in requirements.GroupBy(r => r.Key, StringComparer.Ordinal))
        {
            var grouped = alternativeGroup.ToList();
            var altKey = Truncate(alternativeGroup.Key, 1000);
            var row = managedRows.FirstOrDefault(r =>
                string.Equals(r.AlternativeKey, altKey, StringComparison.Ordinal));
            if (!AlternativeNeedsPurchase(grouped, row)) continue;

            if (row is null)
            {
                row = new ShoppingItem
                {
                    Name = Truncate(grouped[0].ShoppingName, 200),
                    Category = "Recipe",
                    Origin = ShoppingOrigin.Recipe,
                    AlternativeKey = altKey,
                };
                db.ShoppingItems.Add(row);
                managedRows.Add(row);
            }

            row.Name = Truncate(grouped[0].ShoppingName, 200);
            row.PantryItemId = null;
            row.AlternativeKey = altKey;
            row.AlternativePantryItemIds = TruncateNullable(SerializePantryIds(grouped
                .SelectMany(r => r.PantryItems).Select(p => p.Id)), 1000);

            foreach (var sourceGroup in grouped.GroupBy(r => r.Source.Key, StringComparer.Ordinal))
            {
                var sourceRequirements = sourceGroup.ToList();
                var first = sourceRequirements[0];
                var (requiredQuantity, unit) = SafeAlternativeAmount(sourceRequirements);
                var contribution = TakeStaleContribution(staleContributions, first.Source.Key, row.Id)
                    ?? NewContribution(db);
                contribution.SourceKey = first.Source.Key;
                contribution.SourceLabel = first.Source.Label;
                contribution.RequiredQuantity = requiredQuantity;
                contribution.Unit = unit;
                row.Contributions.Add(contribution);
            }
            affected.Add(row);
        }
    }

    /// <summary>
    /// Tracks a new contribution as Added up front. Left to navigation fix-up, EF sees
    /// its client-generated Guid on an already-loaded row, assumes it exists and
    /// issues an UPDATE that hits no row (DbUpdateConcurrencyException).
    /// </summary>
    private static ShoppingContribution NewContribution(MiseDbContext db)
    {
        var contribution = new ShoppingContribution();
        db.ShoppingContributions.Add(contribution);
        return contribution;
    }

    private static ShoppingContribution? TakeStaleContribution(
        HashSet<ShoppingContribution> staleContributions, string sourceKey, Guid rowId)
    {
        var contribution = staleContributions.FirstOrDefault(c =>
            c.SourceKey == sourceKey && c.ShoppingItemId == rowId);
        if (contribution is not null) staleContributions.Remove(contribution);
        return contribution;
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

    private static AlternativeRequirement? CreateAlternativeRequirement(ShoppingRecipeSource source,
        IReadOnlyList<RecipeIngredient> options,
        IReadOnlyDictionary<Guid, PantryItem> pantryById)
    {
        var namedOptions = options.Where(i =>
            IngredientMatcher.Normalize(i.Name).Length > 0).ToList();
        if (namedOptions.Count == 0) return null;

        var pantryItems = namedOptions
            .Select(i => i.PantryItemId is Guid id ? pantryById.GetValueOrDefault(id) : null)
            .Where(p => p is not null)
            .Cast<PantryItem>()
            .DistinctBy(p => p.Id)
            .ToList();
        var names = namedOptions.Select(i =>
                i.PantryItemId is Guid id && pantryById.TryGetValue(id, out var pantry)
                    ? pantry.Name
                    : i.Name.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
        var key = string.Join("|", names.Select(IngredientMatcher.Normalize)
            .Where(n => n.Length > 0)
            .Distinct(StringComparer.Ordinal)
            .OrderBy(n => n, StringComparer.Ordinal));
        if (key.Length == 0) return null;

        return new AlternativeRequirement
        {
            Source = source,
            Key = key,
            ShoppingName = string.Join(" lub ", names),
            Options = namedOptions,
            PantryItems = pantryItems,
        };
    }

    private static bool NeedsPurchase(IReadOnlyList<Requirement> requirements, ShoppingItem? existingRow = null)
    {
        var pantryItem = requirements[0].PantryItem;
        if (pantryItem is null) return true;

        var incomingKeys = requirements.Select(r => r.Source.Key).ToHashSet(StringComparer.Ordinal);
        var prior = existingRow?.Contributions
            .Where(c => !incomingKeys.Contains(c.SourceKey))
            .ToList() ?? [];

        var unit = SafeUnit(requirements);
        if (unit is null || prior.Any(c => c.RequiredQuantity is not > 0 || c.Unit != unit))
        {
            var comparableKnownDemand = requirements
                .Where(r => r.Ingredient.AmountValue is > 0
                    && r.Ingredient.AmountUnit == pantryItem.Unit)
                .Sum(r => r.Ingredient.AmountValue!.Value)
                + prior
                    .Where(c => c.RequiredQuantity is > 0 && c.Unit == pantryItem.Unit)
                    .Sum(c => c.RequiredQuantity!.Value);
            var stock = StockReliability.PlanningQuantity(pantryItem);
            return stock <= 0 || comparableKnownDemand > stock;
        }
        var required = requirements.Sum(r => r.Ingredient.AmountValue!.Value)
            + prior.Sum(c => c.RequiredQuantity!.Value);
        return required > StockReliability.PlanningQuantity(pantryItem);
    }

    private static bool AlternativeNeedsPurchase(IReadOnlyList<AlternativeRequirement> requirements,
        ShoppingItem? existingRow = null)
    {
        var incomingKeys = requirements.Select(r => r.Source.Key).ToHashSet(StringComparer.Ordinal);
        var prior = existingRow?.Contributions
            .Where(c => !incomingKeys.Contains(c.SourceKey))
            .ToList() ?? [];

        var safe = requirements.Select(SafeAlternativeAmount).ToList();
        if (safe.All(x => x.RequiredQuantity is > 0 && x.Unit is not null)
            && safe.Select(x => x.Unit).Distinct().Count() == 1
            && prior.All(c => c.RequiredQuantity is > 0 && c.Unit == safe[0].Unit))
        {
            var unit = safe[0].Unit!.Value;
            var allDemands = safe.Select(x => x.RequiredQuantity!.Value)
                .Concat(prior.Select(c => c.RequiredQuantity!.Value));
            return !CanSatisfyAlternativeDemands(
                allDemands,
                requirements.SelectMany(r => r.PantryItems).DistinctBy(p => p.Id), unit);
        }

        // Unknown amounts retain the existing presence-based semantics: any one
        // alternative on hand satisfies the OR requirement.
        return !requirements.SelectMany(r => r.PantryItems)
            .DistinctBy(p => p.Id).Any(p => StockReliability.PlanningQuantity(p) > 0);
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

    private static (decimal? RequiredQuantity, PantryUnit? Unit) SafeAlternativeAmount(
        AlternativeRequirement requirement)
    {
        PantryUnit? unit = null;
        decimal? amount = null;
        foreach (var option in requirement.Options)
        {
            if (option.AmountValue is not > 0 || option.AmountUnit is not PantryUnit current)
                return (null, null);
            if (option.PantryItemId is Guid id
                && requirement.PantryItems.FirstOrDefault(p => p.Id == id) is PantryItem pantry
                && pantry.Unit != current)
                return (null, null);
            if (unit is PantryUnit previous && previous != current) return (null, null);
            if (amount is decimal previousAmount && previousAmount != option.AmountValue.Value)
                return (null, null);
            unit = current;
            amount = option.AmountValue.Value;
        }
        return (amount, unit);
    }

    private static (decimal? RequiredQuantity, PantryUnit? Unit) SafeAlternativeAmount(
        IReadOnlyList<AlternativeRequirement> requirements)
    {
        decimal total = 0;
        PantryUnit? unit = null;
        foreach (var requirement in requirements)
        {
            var safe = SafeAlternativeAmount(requirement);
            if (safe.RequiredQuantity is not > 0 || safe.Unit is not PantryUnit current)
                return (null, null);
            if (unit is PantryUnit previous && previous != current) return (null, null);
            total += safe.RequiredQuantity.Value;
            unit = current;
        }
        return (total, unit);
    }

    private static ShoppingItem? FindManagedRow(IEnumerable<ShoppingItem> rows, ProductKey key) =>
        key.PantryItemId is Guid pantryId
            ? rows.FirstOrDefault(r => r.PantryItemId == pantryId && r.AlternativeKey is null)
            : rows.FirstOrDefault(r => r.PantryItemId is null && r.AlternativeKey is null
                && IngredientMatcher.Normalize(r.Name) == key.NormalizedName);

    private static bool RowNeedsPurchase(ShoppingItem row,
        IReadOnlyDictionary<Guid, PantryItem> pantryById)
    {
        if (row.AlternativeKey is not null)
        {
            var alternatives = ParsePantryIds(row.AlternativePantryItemIds)
                .Select(id => pantryById.GetValueOrDefault(id))
                .Where(p => p is not null)
                .Cast<PantryItem>()
                .ToList();
            var contributions = row.Contributions.ToList();
            if (contributions.All(c => c.RequiredQuantity is > 0 && c.Unit is not null)
                && contributions.Select(c => c.Unit).Distinct().Count() == 1)
            {
                var unit = contributions[0].Unit!.Value;
                return !CanSatisfyAlternativeDemands(
                    contributions.Select(c => c.RequiredQuantity!.Value), alternatives, unit);
            }
            return !alternatives.Any(p => StockReliability.PlanningQuantity(p) > 0);
        }

        if (row.PantryItemId is not Guid id || !pantryById.TryGetValue(id, out var pantry))
            return true;
        if (row.Quantity is decimal quantity) return quantity > 0;
        var knownComparableDemand = row.Contributions
            .Where(c => c.RequiredQuantity is > 0 && c.Unit == pantry.Unit)
            .Sum(c => c.RequiredQuantity!.Value);
        var stock = StockReliability.PlanningQuantity(pantry);
        return stock <= 0 || knownComparableDemand > stock;
    }

    private static void Recalculate(ShoppingItem row,
        IReadOnlyDictionary<Guid, PantryItem> pantryById)
    {
        if (row.AlternativeKey is not null)
        {
            // Keep OR rows explicit and unquantified: a numeric total would hide
            // which option the cook intends to buy.
            row.Quantity = null;
            row.Unit = null;
            RecalculateReason(row);
            return;
        }

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
                && item.Unit == unit ? StockReliability.PlanningQuantity(item) : 0;
            row.Quantity = Math.Max(0, total - stock);
            row.Unit = unit;
        }
        else
        {
            row.Quantity = null;
            row.Unit = null;
        }

        RecalculateReason(row);
    }

    private static void RecalculateReason(ShoppingItem row) =>
        row.Reason = Truncate("Do: " + string.Join("; ", row.Contributions
            .GroupBy(c => c.SourceLabel, StringComparer.Ordinal)
            .OrderBy(g => g.Key, Pl.Comparer)
            .Select(g => g.Count() > 1 ? $"{g.Key} ×{g.Count()}" : g.Key)), 1000);

    private static string Truncate(string value, int maxLen) =>
        value.Length <= maxLen ? value : value[..maxLen];

    private static string? TruncateNullable(string? value, int maxLen) =>
        value is null || value.Length <= maxLen ? value : value[..maxLen];

    private static bool CanSatisfyAlternativeDemands(IEnumerable<decimal> requested,
        IEnumerable<PantryItem> pantryItems, PantryUnit unit) =>
        CanSatisfyAlternativeDemandsUsing(requested, pantryItems, unit,
            p => StockReliability.PlanningQuantity(p));

    private static bool CanSatisfyAlternativeDemandsUsing(IEnumerable<decimal> requested,
        IEnumerable<PantryItem> pantryItems, PantryUnit unit,
        Func<PantryItem, decimal> stockOf)
    {
        var demands = requested.Where(x => x > 0).OrderByDescending(x => x).ToArray();
        var stocks = pantryItems.Where(p => p.Unit == unit && stockOf(p) > 0)
            .Select(stockOf).OrderByDescending(x => x).ToArray();
        const int maxSteps = 10_000;
        var steps = 0;
        return Assign(0);

        bool Assign(int demandIndex)
        {
            if (demandIndex == demands.Length) return true;
            if (++steps > maxSteps) return false;
            decimal? previousStock = null;
            for (var i = 0; i < stocks.Length; i++)
            {
                if (stocks[i] < demands[demandIndex] || stocks[i] == previousStock) continue;
                previousStock = stocks[i];
                stocks[i] -= demands[demandIndex];
                if (Assign(demandIndex + 1)) return true;
                stocks[i] += demands[demandIndex];
                if (steps > maxSteps) return false;
            }
            return false;
        }
    }

    private static string? SerializePantryIds(IEnumerable<Guid> ids)
    {
        var value = string.Join(';', ids.Distinct().OrderBy(id => id));
        return value.Length == 0 ? null : value;
    }

    private static IEnumerable<Guid> ParsePantryIds(string? value) =>
        (value ?? "").Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(token => Guid.TryParse(token, out var id) ? id : (Guid?)null)
            .Where(id => id is not null)
            .Select(id => id!.Value);

    private static RowSnapshot Snapshot(ShoppingItem row) => new(
        row.Name, row.Reason, row.Quantity, row.Unit,
        row.AlternativeKey, row.AlternativePantryItemIds,
        string.Join("|", row.Contributions
            .OrderBy(c => c.SourceKey, StringComparer.Ordinal)
            .Select(c => $"{c.SourceKey}\u001f{c.SourceLabel}\u001f{c.RequiredQuantity}\u001f{c.Unit}")));
}
