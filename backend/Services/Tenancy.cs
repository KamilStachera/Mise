using Microsoft.Extensions.DependencyInjection.Extensions;

namespace Mise.Api.Services;

public static class TenancyServiceCollectionExtensions
{
    /// <summary>
    /// Tenant (which household the DbContext sees) and caller, both filled per request by
    /// <see cref="ApiAccessMiddleware"/>; <see cref="PersonScope"/> = the X-Person pick within the
    /// household, else the caller's own person (TryAdd: a test may register a fixed one first).
    /// </summary>
    public static IServiceCollection AddTenancy(this IServiceCollection services)
    {
        services.TryAddScoped<TenantContext>();
        services.TryAddScoped<Caller>();
        services.TryAddScoped(sp => new PersonScope(sp.GetRequiredService<Caller>().Acting?.Id ?? 0));
        return services;
    }
}

/// <summary>
/// Which household the current scope works on. <c>MiseDbContext</c> reads it in its global
/// query filters and when stamping new rows. Fails closed: a fresh scope (no household, not
/// system) sees no household-owned rows at all. <c>ApiAccessMiddleware</c> sets it per request;
/// boot code and background workers call <see cref="UseSystem"/> explicitly.
/// </summary>
public sealed class TenantContext
{
    public int? HouseholdId { get; private set; }

    /// <summary>Sees every household (boot passes, background workers, token lookups). Never for a user request.</summary>
    public bool IsSystem { get; private set; }

    public TenantContext UseHousehold(int householdId)
    {
        HouseholdId = householdId;
        IsSystem = false;
        return this;
    }

    public TenantContext UseSystem()
    {
        HouseholdId = null;
        IsSystem = true;
        return this;
    }

    public static TenantContext For(int householdId) => new TenantContext().UseHousehold(householdId);

    public static TenantContext System() => new TenantContext().UseSystem();
}

/// <summary>Thrown when a write would cross a household boundary — a bug, never user input.</summary>
public sealed class TenantViolationException(string message) : InvalidOperationException(message);
