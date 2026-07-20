using Mise.Api.Domain;

namespace Mise.Api.Services;

/// <summary>
/// Owns the approximate-stock rules. Quantity is the best estimate; the effective
/// planning quantity is a conservative lower bound that expires by category.
/// </summary>
public sealed class StockReliability
{
    public const decimal CookDeductionSafetyFactor = 1.2m;

    public static TimeSpan Lifetime(PantryCategory category) => category switch
    {
        PantryCategory.Produce => TimeSpan.FromDays(4),
        PantryCategory.Fridge => TimeSpan.FromDays(7),
        PantryCategory.Pantry => TimeSpan.FromDays(30),
        PantryCategory.Spices => TimeSpan.FromDays(90),
        _ => TimeSpan.Zero,
    };

    public static decimal PlanningQuantity(PantryItem item, DateTimeOffset? at = null)
    {
        var now = at ?? DateTimeOffset.UtcNow;
        if (item.ReliabilityUpdatedAt is not DateTimeOffset observedAt
            || now - observedAt > Lifetime(item.Category))
            return 0;
        return Math.Clamp(item.ReliableQuantity, 0, item.Quantity);
    }

    public static string Confidence(PantryItem item, DateTimeOffset? at = null)
    {
        var now = at ?? DateTimeOffset.UtcNow;
        if (item.ReliabilityUpdatedAt is not DateTimeOffset observedAt
            || now - observedAt > Lifetime(item.Category))
            return "stale";
        var planning = PlanningQuantity(item, at);
        return planning >= item.Quantity ? "confirmed" : "estimated";
    }

    public void Confirm(PantryItem item, decimal quantity, DateTimeOffset? at = null)
    {
        var value = Math.Max(0, quantity);
        item.Quantity = value;
        item.ReliableQuantity = value;
        item.ReliabilityUpdatedAt = at ?? DateTimeOffset.UtcNow;
        item.UpdatedAt = at ?? DateTimeOffset.UtcNow;
    }

    public void ApplyReceiptDelta(PantryItem item, decimal delta, DateTimeOffset? at = null)
    {
        var now = at ?? DateTimeOffset.UtcNow;
        var currentReliable = PlanningQuantity(item, now);
        item.Quantity = Math.Max(0, item.Quantity + delta);
        item.ReliableQuantity = Math.Clamp(currentReliable + delta, 0, item.Quantity);
        item.ReliabilityUpdatedAt = now;
        item.UpdatedAt = now;
    }

    public decimal ApplyCookDeduction(PantryItem item, decimal amount, DateTimeOffset? at = null)
    {
        var now = at ?? DateTimeOffset.UtcNow;
        var currentReliable = PlanningQuantity(item, now);
        var taken = Math.Min(item.Quantity, Math.Max(0, amount));
        item.Quantity -= taken;
        item.ReliableQuantity = Math.Clamp(
            currentReliable - amount * CookDeductionSafetyFactor,
            0,
            item.Quantity);
        item.ReliabilityUpdatedAt = now;
        item.UpdatedAt = now;
        return taken;
    }
}
