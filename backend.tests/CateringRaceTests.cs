using Microsoft.EntityFrameworkCore;
using Mise.Api.Data;
using Mise.Api.Domain;
using Mise.Api.Services;
using Xunit;

namespace Mise.Api.Tests;

/// <summary>
/// Pages load /plan, /body/budget and /body/progress in parallel and each materializes the
/// catering backlog — that once wrote every box three times. Only one request may win.
/// </summary>
public class CateringRaceTests
{
    private static readonly DateOnly Today = new(2026, 11, 14);

    [Fact]
    public async Task ParallelEnsure_WritesEachDayOnce()
    {
        var name = Guid.NewGuid().ToString();
        await using (var seed = Db(name))
        {
            seed.Caterings.Add(new Catering { PersonId = 1, Enabled = true, Kcal = 2000, Weekdays = CateringService.AllWeekdays, StartDate = Today.AddDays(-4) });
            await seed.SaveChangesAsync();
        }

        await using var a = Db(name);
        await using var b = Db(name);
        // Request B has already read the old MaterializedThrough when request A saves.
        await b.Caterings.FirstAsync();
        await new CateringService(a, new PersonScope(1)).EnsureAsync(Today);
        await new CateringService(b, new PersonScope(1)).EnsureAsync(Today);   // loses the race quietly

        await using var check = Db(name);
        var days = await check.PlanEntries.Where(e => e.IsCatering).Select(e => e.Date).ToListAsync();
        Assert.Equal(5, days.Count);
        Assert.Equal(5, days.Distinct().Count());
        Assert.Equal(Today, (await check.Caterings.SingleAsync()).MaterializedThrough);
    }

    [Fact]
    public async Task MovingTheStartBack_FillsOnlyTheMissingDays()
    {
        await using var db = Db(Guid.NewGuid().ToString());
        var catering = new CateringService(db, new PersonScope(1));
        await catering.SaveAsync(true, 2000, null, null, null, CateringService.AllWeekdays, Today.AddDays(-2), Today);
        Assert.Equal(3, await db.PlanEntries.CountAsync(e => e.IsCatering));

        await catering.SaveAsync(true, 2000, null, null, null, CateringService.AllWeekdays, Today.AddDays(-5), Today);
        var days = await db.PlanEntries.Where(e => e.IsCatering).Select(e => e.Date).ToListAsync();
        Assert.Equal(6, days.Count);
        Assert.Equal(6, days.Distinct().Count());
    }

    [Fact]
    public async Task LoggingABoxTwiceADay_IsAConflict()
    {
        await using var db = Db(Guid.NewGuid().ToString());
        db.Caterings.Add(new Catering { PersonId = 1, Enabled = true, Kcal = 2000, Weekdays = 0, StartDate = Today });
        await db.SaveChangesAsync();
        var catering = new CateringService(db, new PersonScope(1));

        await catering.LogAsync(Today);
        var ex = await Assert.ThrowsAsync<DiaryException>(() => catering.LogAsync(Today));
        Assert.Equal(409, ex.Status);
    }

    private static MiseDbContext Db(string name) =>
        new(new DbContextOptionsBuilder<MiseDbContext>().UseInMemoryDatabase(name).Options);
}
