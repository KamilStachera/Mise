using Microsoft.EntityFrameworkCore;
using Mise.Api.Data;
using Mise.Api.Domain;

namespace Mise.Api.Services;

/// <summary>
/// Diet catering for the request's <see cref="PersonScope"/>: on every delivery weekday from
/// <see cref="Catering.StartDate"/> up to today one eaten <see cref="PlanEntry"/> carrying a
/// snapshot of the box numbers. Written lazily (before the diary is read) and exactly once per
/// day — <see cref="Catering.MaterializedThrough"/> marks the days already handled, so a day she
/// deleted ("dziś bez cateringu") never comes back and new numbers only apply from today on.
/// </summary>
public class CateringService(MiseDbContext db, PersonScope? person = null)
{
    public const string Title = "Catering";
    public const int AllWeekdays = 0b1111111;
    public int PersonId { get; } = (person ?? PersonScope.Default).Id;

    /// <summary>Bit for a weekday in <see cref="Catering.Weekdays"/> (bit 0 = Monday).</summary>
    public static int Bit(DayOfWeek d) => 1 << (((int)d + 6) % 7);

    public static bool Delivers(Catering c, DateOnly date) => (c.Weekdays & Bit(date.DayOfWeek)) != 0;

    public Task<Catering?> GetAsync(CancellationToken ct = default) =>
        db.Caterings.AsNoTracking().FirstOrDefaultAsync(c => c.PersonId == PersonId, ct);

    /// <summary>Writes the missing catering days up to today. Cheap no-op once today is done.</summary>
    public async Task EnsureAsync(DateOnly today, CancellationToken ct = default)
    {
        var c = await db.Caterings.FirstOrDefaultAsync(x => x.PersonId == PersonId, ct);
        if (c is null || !c.Enabled || c.Kcal <= 0) return;
        if (c.MaterializedThrough is DateOnly done && done >= today) return;

        var from = c.MaterializedThrough is DateOnly d ? d.AddDays(1) : c.StartDate;
        if (from < c.StartDate) from = c.StartDate;
        for (var day = from; day <= today; day = day.AddDays(1))
        {
            if (Delivers(c, day)) db.PlanEntries.Add(NewEntry(c, day));
        }
        c.MaterializedThrough = today;
        await db.SaveChangesAsync(ct);
    }

    /// <summary>Saves the settings. Days already written keep their old numbers (snapshots).</summary>
    public async Task<Catering> SaveAsync(bool enabled, int kcal, decimal? protein, decimal? fat, decimal? carbs,
        int weekdays, DateOnly startDate, DateOnly today, CancellationToken ct = default)
    {
        if (kcal is < 0 or > 10000) throw new DiaryException("Kcal poza zakresem.");
        if (enabled && kcal == 0) throw new DiaryException("Podaj kcal cateringu.");
        var c = await db.Caterings.FirstOrDefaultAsync(x => x.PersonId == PersonId, ct);
        if (c is null)
        {
            c = new Catering { PersonId = PersonId };
            db.Caterings.Add(c);
        }
        // Moving the start back re-opens the days before it; moving it forward never deletes anything.
        if (c.MaterializedThrough is DateOnly done && startDate <= done && startDate < c.StartDate)
            c.MaterializedThrough = startDate.AddDays(-1);
        (c.Enabled, c.Kcal, c.Protein, c.Fat, c.Carbs) = (enabled, kcal, protein, fat, carbs);
        c.Weekdays = weekdays & AllWeekdays;
        c.StartDate = startDate;
        c.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);
        await EnsureAsync(today, ct);
        return c;
    }

    /// <summary>Logs the box on a day without delivery (a weekend order) or one deleted by mistake.</summary>
    public async Task<PlanEntry> LogAsync(DateOnly date, CancellationToken ct = default)
    {
        var c = await db.Caterings.AsNoTracking().FirstOrDefaultAsync(x => x.PersonId == PersonId, ct)
            ?? throw new DiaryException("Najpierw ustaw catering.", StatusCodes.Status404NotFound);
        var entry = NewEntry(c, date);
        db.PlanEntries.Add(entry);
        await db.SaveChangesAsync(ct);
        return entry;
    }

    private static PlanEntry NewEntry(Catering c, DateOnly day)
    {
        var entry = new PlanEntry
        {
            PersonId = c.PersonId,
            Date = day,
            Slot = MealSlot.Breakfast,
            Title = Title,
            IsCatering = true,
            Kcal = c.Kcal,
            Protein = c.Protein,
            Fat = c.Fat,
            Carbs = c.Carbs,
        };
        DiaryService.SetEaten(entry, true);
        return entry;
    }
}
