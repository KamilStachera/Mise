using Microsoft.EntityFrameworkCore;
using Mise.Api.Data;
using Mise.Api.Domain;
using Npgsql;

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
    public const int MaxPausesPerPerson = 50;
    public int PersonId { get; } = (person ?? PersonScope.Default).Id;

    /// <summary>Bit for a weekday in <see cref="Catering.Weekdays"/> (bit 0 = Monday).</summary>
    public static int Bit(DayOfWeek d) => 1 << (((int)d + 6) % 7);

    public static bool Delivers(Catering c, DateOnly date) => (c.Weekdays & Bit(date.DayOfWeek)) != 0;

    public static bool IsPaused(IEnumerable<CateringPause> pauses, DateOnly date) =>
        pauses.Any(p => date >= p.From && date <= p.To);

    public Task<Catering?> GetAsync(CancellationToken ct = default) =>
        db.Caterings.AsNoTracking().FirstOrDefaultAsync(c => c.PersonId == PersonId, ct);

    public Task<List<CateringPause>> GetPausesAsync(CancellationToken ct = default) =>
        db.CateringPauses.AsNoTracking()
            .Where(p => p.PersonId == PersonId)
            .OrderBy(p => p.From).ThenBy(p => p.To)
            .ToListAsync(ct);

    /// <summary>
    /// Writes the missing catering days up to today. Cheap no-op once today is done. Pages load
    /// /plan, /body/budget and /body/progress in parallel and each calls this, so several requests
    /// race for the same backlog: <see cref="Catering.MaterializedThrough"/> is a concurrency token
    /// (and a unique index allows one catering entry per person, day and slot), so only the first save
    /// lands and the others drop their copies.
    /// </summary>
    public async Task EnsureAsync(DateOnly today, CancellationToken ct = default)
    {
        var c = await db.Caterings.FirstOrDefaultAsync(x => x.PersonId == PersonId, ct);
        if (c is null || !c.Enabled || c.Kcal <= 0) return;
        if (c.MaterializedThrough is DateOnly done && done >= today) return;

        var from = c.MaterializedThrough is DateOnly d ? d.AddDays(1) : c.StartDate;
        if (from < c.StartDate) from = c.StartDate;
        var pauses = await db.CateringPauses.AsNoTracking()
            .Where(p => p.PersonId == PersonId && p.To >= from && p.From <= today)
            .ToListAsync(ct);
        // Idempotent: a day that already has its box (written by a parallel request, or before the
        // start date was moved back in SaveAsync) is never written twice.
        var existing = (await db.PlanEntries.AsNoTracking()
            .Where(e => e.PersonId == PersonId && e.IsCatering && e.Date >= from && e.Date <= today)
            .Select(e => e.Date).ToListAsync(ct)).ToHashSet();
        var added = new List<PlanEntry>();
        for (var day = from; day <= today; day = day.AddDays(1))
        {
            if (Delivers(c, day) && !IsPaused(pauses, day) && !existing.Contains(day))
                added.AddRange(NewEntries(c, day));
        }
        db.PlanEntries.AddRange(added);
        c.MaterializedThrough = today;
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException ex) when (ex is DbUpdateConcurrencyException || IsDuplicateCatering(ex))
        {
            // Another request materialized these days first: forget our copies, keep theirs.
            foreach (var entry in added) db.Entry(entry).State = EntityState.Detached;
            await db.Entry(c).ReloadAsync(ct);
        }
    }

    public const string OnePerSlotIndex = "IX_PlanEntries_PersonId_Date_Slot_Catering";
    public const string OnePerDayIndex = OnePerSlotIndex;

    private static bool IsDuplicateCatering(DbUpdateException ex) =>
        ex.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation } pg
        && pg.ConstraintName is OnePerSlotIndex or "IX_PlanEntries_PersonId_Date_Catering";

    /// <summary>True when the person already has any catering entry that day.</summary>
    public Task<bool> HasEntryAsync(int personId, DateOnly date, Guid? except = null, CancellationToken ct = default) =>
        db.PlanEntries.AnyAsync(e => e.PersonId == personId && e.Date == date && e.IsCatering && e.Id != except, ct);

    /// <summary>Saves the settings. Days already written keep their old numbers (snapshots).</summary>
    public async Task<Catering> SaveAsync(bool enabled, int kcal, decimal? protein, decimal? fat, decimal? carbs,
        int weekdays, DateOnly startDate, DateOnly today, CancellationToken ct = default, bool splitMeals = false)
    {
        if (kcal is < 0 or > 10000) throw new DiaryException("Kcal poza zakresem.");
        if (enabled && kcal == 0) throw new DiaryException("Podaj kcal cateringu.");
        if (protein is < 0 or > 10000 || fat is < 0 or > 10000 || carbs is < 0 or > 10000)
            throw new DiaryException("Makroskładniki poza zakresem.");
        if (startDate < today.AddDays(-365) || startDate > today.AddDays(90))
            throw new DiaryException("Data startu może być najwyżej rok wstecz i 90 dni naprzód.");

        var c = await db.Caterings.FirstOrDefaultAsync(x => x.PersonId == PersonId, ct);
        var isNew = c is null;
        var wasEnabled = c?.Enabled == true;
        var oldStart = c?.StartDate;
        if (c is null)
        {
            c = new Catering { PersonId = PersonId };
            db.Caterings.Add(c);
        }

        (c.Enabled, c.Kcal, c.Protein, c.Fat, c.Carbs) = (enabled, kcal, protein, fat, carbs);
        c.Weekdays = weekdays & AllWeekdays;
        c.StartDate = startDate;
        c.SplitMeals = splitMeals;
        c.UpdatedAt = DateTimeOffset.UtcNow;

        if (!enabled)
        {
            // Mark today as handled so pausing and later resuming never backfills the paused gap.
            if (c.MaterializedThrough is null || c.MaterializedThrough < today)
                c.MaterializedThrough = today;
        }
        else if (!wasEnabled && !isNew && c.MaterializedThrough is DateOnly pausedThrough && pausedThrough < today.AddDays(-1))
        {
            c.MaterializedThrough = today.AddDays(-1);
        }

        // Moving the start back backfills ONLY the days strictly before the old start date so
        // days the user already deleted within [oldStart .. MaterializedThrough] never come back.
        var backfillAdded = new List<PlanEntry>();
        if (enabled && oldStart is DateOnly prevStart && c.MaterializedThrough is not null && startDate < prevStart)
        {
            var backfillEnd = prevStart.AddDays(-1);
            if (backfillEnd > today) backfillEnd = today;
            if (startDate <= backfillEnd)
            {
                var pauses = await db.CateringPauses.AsNoTracking()
                    .Where(p => p.PersonId == PersonId && p.To >= startDate && p.From <= backfillEnd)
                    .ToListAsync(ct);
                var existing = (await db.PlanEntries.AsNoTracking()
                    .Where(e => e.PersonId == PersonId && e.IsCatering && e.Date >= startDate && e.Date <= backfillEnd)
                    .Select(e => e.Date).ToListAsync(ct)).ToHashSet();
                for (var day = startDate; day <= backfillEnd; day = day.AddDays(1))
                {
                    if (Delivers(c, day) && !IsPaused(pauses, day) && !existing.Contains(day))
                        backfillAdded.AddRange(NewEntries(c, day));
                }
                db.PlanEntries.AddRange(backfillAdded);
            }
        }

        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException ex) when (IsDuplicateCatering(ex))
        {
            foreach (var entry in backfillAdded) db.Entry(entry).State = EntityState.Detached;
            await db.SaveChangesAsync(ct);
        }
        await EnsureAsync(today, ct);
        return c;
    }

    public async Task<CateringPause> AddPauseAsync(DateOnly from, DateOnly to, string? note, DateOnly today,
        CancellationToken ct = default)
    {
        if (to < from) throw new DiaryException("Data końcowa musi być późniejsza lub równa początkowej.");
        if (to.DayNumber - from.DayNumber > 365) throw new DiaryException("Pauza może trwać maksymalnie rok.");
        if (from < today.AddYears(-1) || to > today.AddYears(2))
            throw new DiaryException("Zakres dat pauzy poza dozwolonym przedziałem.");
        var cleanNote = string.IsNullOrWhiteSpace(note) ? null : note.Trim();
        if (cleanNote is { Length: > 120 }) throw new DiaryException("Notatka może mieć maks. 120 znaków.");
        var count = await db.CateringPauses.CountAsync(p => p.PersonId == PersonId, ct);
        if (count >= MaxPausesPerPerson) throw new DiaryException($"Maks. {MaxPausesPerPerson} pauz cateringu.");

        var pause = new CateringPause { PersonId = PersonId, From = from, To = to, Note = cleanNote };
        db.CateringPauses.Add(pause);
        // If the pause covers today, drop today's auto-materialized box immediately (past days stay untouched).
        if (today >= from && today <= to)
        {
            var todays = await db.PlanEntries
                .Where(e => e.PersonId == PersonId && e.IsCatering && e.Date == today)
                .ToListAsync(ct);
            if (todays.Count > 0) db.PlanEntries.RemoveRange(todays);
        }
        await db.SaveChangesAsync(ct);
        return pause;
    }

    public async Task<bool> DeletePauseAsync(Guid id, CancellationToken ct = default)
    {
        var pause = await db.CateringPauses.FirstOrDefaultAsync(p => p.Id == id && p.PersonId == PersonId, ct);
        if (pause is null) return false;
        db.CateringPauses.Remove(pause);
        await db.SaveChangesAsync(ct);
        return true;
    }

    public async Task<int> DeleteDayAsync(DateOnly date, CancellationToken ct = default)
    {
        var rows = await db.PlanEntries
            .Where(e => e.PersonId == PersonId && e.IsCatering && e.Date == date)
            .ToListAsync(ct);
        if (rows.Count == 0) return 0;
        db.PlanEntries.RemoveRange(rows);
        await db.SaveChangesAsync(ct);
        return rows.Count;
    }

    /// <summary>Logs the box (or 3 split meals) on a day without delivery (a weekend order) or one deleted by mistake.</summary>
    public async Task<PlanEntry> LogAsync(DateOnly date, CancellationToken ct = default)
    {
        var entries = await LogDayAsync(date, ct);
        return entries[0];
    }

    public async Task<List<PlanEntry>> LogDayAsync(DateOnly date, CancellationToken ct = default)
    {
        var c = await db.Caterings.AsNoTracking().FirstOrDefaultAsync(x => x.PersonId == PersonId, ct)
            ?? throw new DiaryException("Najpierw ustaw catering.", StatusCodes.Status404NotFound);
        if (c.Kcal <= 0)
            throw new DiaryException("Najpierw ustaw kcal cateringu.");
        if (await HasEntryAsync(PersonId, date, ct: ct))
            throw new DiaryException("Catering na ten dzień jest już wpisany.", StatusCodes.Status409Conflict);
        var entries = NewEntries(c, date);
        db.PlanEntries.AddRange(entries);
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException ex) when (IsDuplicateCatering(ex))
        {
            throw new DiaryException("Catering na ten dzień jest już wpisany.", StatusCodes.Status409Conflict);
        }
        return entries;
    }

    private static List<PlanEntry> NewEntries(Catering c, DateOnly day)
    {
        if (!c.SplitMeals)
            return [BuildEntry(c, day, "breakfast", Title, c.Kcal, c.Protein, c.Fat, c.Carbs)];

        var (bk, lk, dk) = SplitInt(c.Kcal);
        var (bp, lp, dp) = SplitDec(c.Protein);
        var (bf, lf, df) = SplitDec(c.Fat);
        var (bc, lc, dc) = SplitDec(c.Carbs);
        return
        [
            BuildEntry(c, day, "breakfast", $"{Title} — Śniadanie", bk, bp, bf, bc),
            BuildEntry(c, day, "lunch", $"{Title} — Obiad", lk, lp, lf, lc),
            BuildEntry(c, day, "dinner", $"{Title} — Kolacja", dk, dp, df, dc),
        ];
    }

    private static (int B, int L, int D) SplitInt(int total)
    {
        var b = (int)Math.Round(total * 0.30m, MidpointRounding.AwayFromZero);
        var l = (int)Math.Round(total * 0.40m, MidpointRounding.AwayFromZero);
        return (b, l, Math.Max(0, total - b - l));
    }

    private static (decimal? B, decimal? L, decimal? D) SplitDec(decimal? total)
    {
        if (total is not decimal v) return (null, null, null);
        var b = Math.Round(v * 0.30m, 1, MidpointRounding.AwayFromZero);
        var l = Math.Round(v * 0.40m, 1, MidpointRounding.AwayFromZero);
        return (b, l, Math.Max(0m, Math.Round(v - b - l, 1, MidpointRounding.AwayFromZero)));
    }

    private static PlanEntry BuildEntry(Catering c, DateOnly day, string slot, string title,
        int kcal, decimal? protein, decimal? fat, decimal? carbs)
    {
        var entry = new PlanEntry
        {
            PersonId = c.PersonId,
            Date = day,
            Slot = slot,
            Title = title,
            IsCatering = true,
            Kcal = kcal,
            Protein = protein,
            Fat = fat,
            Carbs = carbs,
        };
        DiaryService.SetEaten(entry, true);
        return entry;
    }
}
