using Mise.Api.Domain;

namespace Mise.Api.Services.Training;

/// <summary>
/// Calendar maths for a program. Week n is the n-th calendar week (Mon–Sun) counted from the
/// Monday of <see cref="TrainingProgram.StartDate"/>; a day sits at (Week, Weekday 0 = Monday).
/// Days before StartDate are not allowed (validation), so week 1 may be partial.
/// </summary>
public static class ProgramSchedule
{
    public enum State { BeforeStart, Scheduled, Rest, Finished }

    public record Today(State State, int? Week, ProgramDay? Day, ProgramDay? Next);

    public static int WeekdayOf(DateOnly d) => ((int)d.DayOfWeek + 6) % 7;

    public static DateOnly MondayOf(DateOnly d) => d.AddDays(-WeekdayOf(d));

    public static DateOnly DateOf(DateOnly startDate, int week, int weekday)
        => MondayOf(startDate).AddDays((week - 1) * 7 + weekday);

    public static DateOnly DateOf(TrainingProgram p, ProgramDay d) => DateOf(p.StartDate, d.Week, d.Weekday);

    /// <summary>Last day (Sunday) of the last week.</summary>
    public static DateOnly EndDate(TrainingProgram p) => MondayOf(p.StartDate).AddDays(p.Weeks * 7 - 1);

    /// <summary>Which week of the program a date falls in (may be ≤ 0 or > Weeks).</summary>
    public static int WeekOf(TrainingProgram p, DateOnly date)
        => (MondayOf(date).DayNumber - MondayOf(p.StartDate).DayNumber) / 7 + 1;

    public static Today Resolve(TrainingProgram p, DateOnly date)
    {
        var next = p.Days
            .Select(d => (Day: d, Date: DateOf(p, d)))
            .Where(x => x.Date > date && x.Date >= p.StartDate)
            .OrderBy(x => x.Date)
            .Select(x => x.Day)
            .FirstOrDefault();

        if (date < p.StartDate) return new(State.BeforeStart, null, null, next);
        if (date > EndDate(p)) return new(State.Finished, null, null, null);

        var week = WeekOf(p, date);
        var weekday = WeekdayOf(date);
        var day = p.Days.FirstOrDefault(d => d.Week == week && d.Weekday == weekday);
        return day is null
            ? new(State.Rest, week, null, next)
            : new(State.Scheduled, week, day, next);
    }
}
