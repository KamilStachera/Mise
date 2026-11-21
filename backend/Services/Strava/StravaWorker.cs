using System.Threading.Channels;
using Microsoft.EntityFrameworkCore;
using Mise.Api.Data;

namespace Mise.Api.Services.Strava;

/// <summary>
/// Webhook events wait here: Strava wants a 200 within 2 seconds, while handling one costs a
/// Strava API round trip or two. Single pod (see README), so an in-memory queue is enough —
/// anything lost on a restart is picked up by the poll.
/// </summary>
public sealed class StravaEventQueue
{
    private readonly Channel<StravaEvent> _channel = Channel.CreateBounded<StravaEvent>(
        new BoundedChannelOptions(500) { FullMode = BoundedChannelFullMode.DropOldest, SingleReader = true });
    private long _subscriptionId;

    /// <summary>Known Strava push subscription id (0 until EnsureSubscriptionAsync confirms it).</summary>
    public long SubscriptionId
    {
        get => Volatile.Read(ref _subscriptionId);
        set => Volatile.Write(ref _subscriptionId, value);
    }

    public bool TryEnqueue(StravaEvent e) => _channel.Writer.TryWrite(e);

    public IAsyncEnumerable<StravaEvent> ReadAllAsync(CancellationToken ct) => _channel.Reader.ReadAllAsync(ct);
}

/// <summary>
/// Runs only when STRAVA_CLIENT_ID/SECRET are set. Handles queued webhook events one by one,
/// makes sure Strava's push subscription points at <see cref="StravaOptions.WebhookUrl"/> once
/// the app is up (Strava validates it by calling us back), and every 3 hours pulls the last
/// days of every connection — the safety net for missed events and for servers Strava can't reach.
/// </summary>
public sealed class StravaWorker(IServiceScopeFactory scopes, StravaEventQueue queue, StravaOptions options,
    IHostApplicationLifetime life, ILogger<StravaWorker> logger) : BackgroundService
{
    public static readonly TimeSpan PollEvery = TimeSpan.FromHours(3);
    public const int PollDays = 3;

    protected override async Task ExecuteAsync(CancellationToken stop)
    {
        if (!options.Configured)
        {
            logger.LogInformation("Strava sync off (STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET not set).");
            return;
        }
        await Task.WhenAll(ConsumeAsync(stop), HousekeepingAsync(stop));
    }

    private async Task ConsumeAsync(CancellationToken stop)
    {
        try
        {
            await foreach (var e in queue.ReadAllAsync(stop))
            {
                try
                {
                    using var scope = scopes.CreateScope();
                    var outcome = await scope.ServiceProvider.GetRequiredService<StravaService>().HandleEventAsync(e, stop);
                    logger.LogInformation("Strava event {Object} {Aspect} {Id} (athlete {Owner}): {Outcome}",
                        e.ObjectType, e.AspectType, e.ObjectId, e.OwnerId, outcome);
                }
                catch (Exception x) when (x is not OperationCanceledException)
                {
                    logger.LogWarning(x, "Strava event {Object} {Id} failed", e.ObjectType, e.ObjectId);
                }
            }
        }
        catch (OperationCanceledException) { }
    }

    private async Task HousekeepingAsync(CancellationToken stop)
    {
        try
        {
            var started = new TaskCompletionSource();
            using (life.ApplicationStarted.Register(() => started.TrySetResult()))
                await started.Task.WaitAsync(stop);
            // Strava calls the webhook back while we subscribe: let the tunnel/nginx see us first.
            await Task.Delay(TimeSpan.FromSeconds(15), stop);
            await EnsureSubscriptionAsync(stop);
            while (!stop.IsCancellationRequested)
            {
                await PollAllAsync(stop);
                await Task.Delay(PollEvery, stop);
            }
        }
        catch (OperationCanceledException) { }
    }

    private async Task EnsureSubscriptionAsync(CancellationToken stop)
    {
        if (options.WebhookUrl is not { } url)
        {
            logger.LogInformation("Strava webhook not registered (PUBLIC_API_BASE isn't https); workouts arrive by the 3-hourly poll.");
            return;
        }
        try
        {
            using var scope = scopes.CreateScope();
            var client = scope.ServiceProvider.GetRequiredService<StravaClient>();
            var subs = await client.ListSubscriptionsAsync(options, stop);
            if (subs.FirstOrDefault(s => string.Equals(s.CallbackUrl, url, StringComparison.OrdinalIgnoreCase)) is { } match)
            {
                queue.SubscriptionId = match.Id;
                logger.LogInformation("Strava webhook subscription OK ({Id}, {Url}).", match.Id, url);
                return;
            }
            // A Strava app has at most one subscription; an old one points at a previous address.
            foreach (var s in subs)
            {
                logger.LogWarning("Replacing Strava webhook subscription {Old} with {New}.", s.CallbackUrl, url);
                await client.DeleteSubscriptionAsync(options, s.Id, stop);
            }
            var created = await client.CreateSubscriptionAsync(options, url, stop);
            queue.SubscriptionId = created.Id;
            logger.LogInformation("Strava webhook subscription {Id} created for {Url}.", created.Id, url);
        }
        catch (Exception x) when (x is not OperationCanceledException)
        {
            logger.LogWarning(x, "Strava webhook subscription failed; workouts arrive by the 3-hourly poll.");
        }
    }

    private async Task PollAllAsync(CancellationToken stop)
    {
        List<(int PersonId, int HouseholdId)> people;
        using (var scope = scopes.CreateScope())
        {
            scope.ServiceProvider.GetRequiredService<TenantContext>().UseSystem();
            people = (await scope.ServiceProvider.GetRequiredService<MiseDbContext>().StravaConnections.AsNoTracking()
                .Select(c => new { c.PersonId, c.HouseholdId }).ToListAsync(stop))
                .Select(c => (c.PersonId, c.HouseholdId)).ToList();
        }
        foreach (var (personId, householdId) in people)
        {
            try
            {
                using var scope = scopes.CreateScope();
                scope.ServiceProvider.GetRequiredService<TenantContext>().UseHousehold(householdId);
                var db = scope.ServiceProvider.GetRequiredService<MiseDbContext>();
                var strava = scope.ServiceProvider.GetRequiredService<StravaService>();
                if (await strava.IsPersonBlockedAsync(personId, stop)) continue;
                if (await db.StravaConnections.FirstOrDefaultAsync(c => c.PersonId == personId, stop) is not { } conn) continue;
                var n = await strava.SyncAsync(conn, PollDays, refreshKnown: false, stop);
                if (n > 0) logger.LogInformation("Strava poll: {Count} new workouts for person {Person}.", n, personId);
            }
            catch (Exception x) when (x is not OperationCanceledException)
            {
                logger.LogWarning(x, "Strava poll for person {Person} failed", personId);
            }
        }
    }
}
