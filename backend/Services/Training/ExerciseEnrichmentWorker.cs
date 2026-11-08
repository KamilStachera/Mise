using Microsoft.EntityFrameworkCore;
using Mise.Api.Data;

namespace Mise.Api.Services.Training;

/// <summary>
/// Fills the exercise catalog in the background with Polish descriptions and verified demo
/// videos, one small batch at a time, on the ChatGPT plan behind Sous. Runs only with
/// AI_PROVIDER=codex and EXERCISE_ENRICH not "off". Steps aside while someone chats with Sous,
/// backs off on errors (longer on the plan's usage limit), and sleeps when nothing is left.
/// </summary>
public sealed class ExerciseEnrichmentWorker(IServiceScopeFactory scopes, EnrichmentState state,
    IConfiguration config, ILogger<ExerciseEnrichmentWorker> logger) : BackgroundService
{
    private static readonly TimeSpan ChatQuietPeriod = TimeSpan.FromMinutes(2);
    private static readonly TimeSpan IdleSleep = TimeSpan.FromMinutes(30);
    private static readonly TimeSpan LimitBackoff = TimeSpan.FromMinutes(30);

    public static bool IsEnabled(IConfiguration config)
        => string.Equals(config["AI_PROVIDER"]?.Trim(), "codex", StringComparison.OrdinalIgnoreCase)
           && !string.Equals(config["EXERCISE_ENRICH"]?.Trim(), "off", StringComparison.OrdinalIgnoreCase);

    protected override async Task ExecuteAsync(CancellationToken stop)
    {
        state.Enabled = IsEnabled(config);
        if (!state.Enabled)
        {
            logger.LogInformation("Exercise enrichment worker off (needs AI_PROVIDER=codex, EXERCISE_ENRICH!=off).");
            return;
        }
        var interval = TimeSpan.FromSeconds(Math.Clamp(config.GetValue("EXERCISE_ENRICH_INTERVAL", 60), 10, 3600));
        var batchSize = Math.Clamp(config.GetValue("EXERCISE_ENRICH_BATCH", 6), 1, 15);
        var errors = 0;
        logger.LogInformation("Exercise enrichment worker on: batch {Batch} every {Interval}s.", batchSize, interval.TotalSeconds);

        // Let migrations, the import and the first context export settle.
        await state.WaitAsync(TimeSpan.FromSeconds(45), stop);

        while (!stop.IsCancellationRequested)
        {
            var delay = interval;
            try
            {
                using var scope = scopes.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<MiseDbContext>();
                var since = DateTimeOffset.UtcNow - ChatQuietPeriod;
                if (await db.ChatMessages.AnyAsync(m => m.CreatedAt > since, stop))
                {
                    delay = TimeSpan.FromSeconds(60); // someone is talking to Sous — don't compete
                }
                else
                {
                    state.Running = true;
                    var result = await scope.ServiceProvider.GetRequiredService<ExerciseEnrichment>()
                        .RunBatchAsync(batchSize, stop);
                    state.LastRunAt = DateTimeOffset.UtcNow;
                    state.LastError = null;
                    state.PausedUntil = null;
                    errors = 0;
                    if (result.Picked == 0) delay = IdleSleep;
                }
            }
            catch (OperationCanceledException) when (stop.IsCancellationRequested) { break; }
            catch (SousLimitException e)
            {
                delay = LimitBackoff;
                state.LastError = "Limit planu ChatGPT — wznowię za 30 min.";
                state.PausedUntil = DateTimeOffset.UtcNow + delay;
                logger.LogWarning("Exercise enrichment paused on the ChatGPT usage limit: {Message}", e.Message);
            }
            catch (Exception e)
            {
                errors++;
                delay = TimeSpan.FromMinutes(Math.Min(30, 2 * errors));
                state.LastError = e.Message;
                state.PausedUntil = DateTimeOffset.UtcNow + delay;
                logger.LogWarning(e, "Exercise enrichment batch failed ({Errors} in a row)", errors);
            }
            finally
            {
                state.Running = false;
            }
            await state.WaitAsync(delay, stop);
        }
    }
}
