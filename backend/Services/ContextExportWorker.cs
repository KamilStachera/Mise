using System.Collections.Concurrent;

namespace Mise.Api.Services;

/// <summary>
/// Coalesces write-triggered context exports per household so interactive taps (checking off
/// shopping items, logging food, MCP batch loops) never block on disk I/O or starve each other.
/// </summary>
public sealed class ContextExportQueue
{
    private readonly ConcurrentDictionary<int, byte> _dirty = new();
    private readonly SemaphoreSlim _signal = new(0, 1);

    public void Enqueue(int householdId)
    {
        if (householdId <= 0) return;
        _dirty[householdId] = 0;
        if (_signal.CurrentCount == 0)
        {
            try { _signal.Release(); }
            catch (SemaphoreFullException) { }
        }
    }

    public async Task<List<int>> WaitAndDrainAsync(TimeSpan debounce, CancellationToken ct)
    {
        await _signal.WaitAsync(ct);
        if (debounce > TimeSpan.Zero)
            await Task.Delay(debounce, ct);
        var ids = new List<int>();
        foreach (var id in _dirty.Keys)
        {
            if (_dirty.TryRemove(id, out _)) ids.Add(id);
        }
        return ids;
    }
}

public sealed class ContextExportWorker(IServiceScopeFactory scopes, ContextExportQueue queue,
    ILogger<ContextExportWorker> logger) : BackgroundService
{
    private static readonly TimeSpan Debounce = TimeSpan.FromMilliseconds(1500);

    protected override async Task ExecuteAsync(CancellationToken stop)
    {
        while (!stop.IsCancellationRequested)
        {
            List<int> households;
            try { households = await queue.WaitAndDrainAsync(Debounce, stop); }
            catch (OperationCanceledException) when (stop.IsCancellationRequested) { break; }

            foreach (var householdId in households)
            {
                try
                {
                    using var scope = scopes.CreateScope();
                    scope.ServiceProvider.GetRequiredService<TenantContext>().UseHousehold(householdId);
                    var export = scope.ServiceProvider.GetRequiredService<ContextExportService>();
                    // Run to completion even during a quiet reload so recipes/ is never left half-written.
                    await export.ExportAsync(CancellationToken.None);
                }
                catch (Exception ex)
                {
                    logger.LogWarning(ex, "Background context export for household {Household} failed", householdId);
                }
            }
        }
    }
}
