using System.Text;
using Microsoft.EntityFrameworkCore;
using Mise.Api.Data;
using Mise.Api.Domain;

namespace Mise.Api.Services;

/// <summary>One meal of a person's day, as the API and the UI see it.</summary>
public sealed record MealSlotView(string Key, string Name, bool IsSnack, bool Active, int Position);

/// <summary>One row of a <c>PUT /meals</c> list: an existing <see cref="Key"/> to keep, or none for a new meal.</summary>
public sealed record MealSlotInput(string? Key, string Name, bool Snack = false);

/// <summary>
/// The meals of a person's day (<see cref="MealSlot"/>). Nobody gets rows until they edit the
/// list — until then <see cref="Defaults"/> apply, so reads never write and everyone created
/// before (or outside) this feature just works. Writes go through <see cref="RequireAsync"/>:
/// an unknown or removed meal is an error naming the ones that exist.
/// </summary>
public sealed class MealSlots(MiseDbContext db)
{
    public const int MaxActive = 8;
    public const int MaxName = 30;

    /// <summary>The day everyone starts with. "lunch" is Obiad — the token predates custom meals.</summary>
    public static readonly IReadOnlyList<MealSlotView> Defaults =
    [
        new("breakfast", "Śniadanie", false, true, 0),
        new("lunch", "Obiad", false, true, 1),
        new("dinner", "Kolacja", false, true, 2),
        new("snack", "Przekąski", true, true, 3),
    ];

    private static readonly Dictionary<string, MealSlotView> DefaultByKey = Defaults.ToDictionary(d => d.Key);

    /// <summary>All of a person's meals, active ones in day order, then removed ones.</summary>
    public async Task<List<MealSlotView>> ListAsync(int personId, CancellationToken ct = default)
    {
        var rows = await db.MealSlots.AsNoTracking().Where(m => m.PersonId == personId).ToListAsync(ct);
        return rows.Count == 0 ? Defaults.ToList() : Order(rows.Select(View));
    }

    /// <summary>
    /// The active meal an input names — its key or its name (case- and diacritics-insensitive, so
    /// "obiad" finds "lunch"). Null when there is none.
    /// </summary>
    public async Task<MealSlotView?> ResolveAsync(int personId, string? input, CancellationToken ct = default)
    {
        var raw = (input ?? "").Trim();
        if (raw.Length == 0) return null;
        var active = (await ListAsync(personId, ct)).Where(m => m.Active).ToList();
        // Exact key, then name, then key in any case: "Lunch" is the meal called Lunch, not Obiad's "lunch".
        return active.FirstOrDefault(m => m.Key == raw)
            ?? active.FirstOrDefault(m => Fold(m.Name) == Fold(raw))
            ?? active.FirstOrDefault(m => string.Equals(m.Key, raw, StringComparison.OrdinalIgnoreCase));
    }

    /// <summary><see cref="ResolveAsync"/>, or a 400 listing the person's meals.</summary>
    public async Task<MealSlotView> RequireAsync(int personId, string? input, CancellationToken ct = default)
    {
        if (await ResolveAsync(personId, input, ct) is { } slot) return slot;
        var active = (await ListAsync(personId, ct)).Where(m => m.Active);
        throw new DiaryException(
            $"Nieznany posiłek „{input}”. Dostępne: {string.Join(", ", active.Select(m => $"{m.Key} ({m.Name})"))}.");
    }

    /// <summary>
    /// The same meal in someone else's day, for entries cloned onto a partner: same key, else same
    /// name. A 400 naming the person when they have neither.
    /// </summary>
    public async Task<string> MatchForAsync(int personId, MealSlotView slot, CancellationToken ct = default)
    {
        var theirs = (await ListAsync(personId, ct)).Where(m => m.Active).ToList();
        var match = theirs.FirstOrDefault(m => m.Key == slot.Key) ?? theirs.FirstOrDefault(m => Fold(m.Name) == Fold(slot.Name));
        if (match is not null) return match.Key;
        var name = await db.People.AsNoTracking().Where(p => p.Id == personId).Select(p => p.Name).FirstOrDefaultAsync(ct);
        throw new DiaryException($"{name ?? "Domownik"} nie ma posiłku „{slot.Name}”. Dodaj go w jego profilu albo wybierz inny posiłek.");
    }

    /// <summary>Every person's meals in the household (one small query), for code that reads many entries.</summary>
    public async Task<SlotDirectory> DirectoryAsync(CancellationToken ct = default)
    {
        var rows = await db.MealSlots.AsNoTracking().ToListAsync(ct);
        return new SlotDirectory(rows.GroupBy(r => r.PersonId)
            .ToDictionary(g => g.Key, g => g.Select(View).ToDictionary(v => v.Key)));
    }

    /// <summary>
    /// Full replace of a person's day, in order. Rows with a known key are kept (renamed, moved,
    /// revived); rows without one revive a removed meal of the same name or get a fresh key;
    /// meals left out are archived, never deleted — entries keep pointing at them.
    /// </summary>
    public async Task<List<MealSlotView>> ReplaceAsync(int personId, IReadOnlyList<MealSlotInput> input,
        CancellationToken ct = default)
    {
        if (input.Count == 0) throw new DiaryException("Zostaw przynajmniej jeden posiłek.");
        if (input.Count > MaxActive) throw new DiaryException($"Maks. {MaxActive} posiłków dziennie.");
        var names = input.Select(i => (i.Name ?? "").Trim()).ToList();
        if (names.Any(n => n.Length == 0)) throw new DiaryException("Każdy posiłek potrzebuje nazwy.");
        if (names.Any(n => n.Length > MaxName)) throw new DiaryException($"Nazwa posiłku może mieć maks. {MaxName} znaków.");
        if (names.Select(Fold).Distinct().Count() != names.Count) throw new DiaryException("Dwa posiłki mają tę samą nazwę.");
        if (input.All(i => i.Snack)) throw new DiaryException("Przynajmniej jeden posiłek nie może być przekąską.");

        var rows = await db.MealSlots.Where(m => m.PersonId == personId).ToListAsync(ct);
        if (rows.Count == 0)
        {
            // First edit: the virtual defaults become real rows, so their keys (and entries) carry over.
            rows = Defaults.Select(d => new MealSlot
            {
                PersonId = personId, Key = d.Key, Name = d.Name, Position = d.Position, IsSnack = d.IsSnack,
            }).ToList();
            db.MealSlots.AddRange(rows);
        }

        // Keys first, so a keyless row can't take a meal that is listed further down by key;
        // then keyless rows reuse a same-named meal that isn't listed (removed earlier or just now).
        var matched = new MealSlot?[input.Count];
        var kept = new HashSet<MealSlot>();
        for (var i = 0; i < input.Count; i++)
        {
            var key = input[i].Key?.Trim();
            if (key is not { Length: > 0 }) continue;
            matched[i] = rows.FirstOrDefault(r => r.Key == key && !kept.Contains(r));
            if (matched[i] is { } m) kept.Add(m);
        }
        for (var i = 0; i < input.Count; i++)
        {
            if (matched[i] is not null) continue;
            matched[i] = rows.FirstOrDefault(r => !kept.Contains(r) && Fold(r.Name) == Fold(names[i]));
            if (matched[i] is { } m) kept.Add(m);
        }

        var now = DateTimeOffset.UtcNow;
        for (var i = 0; i < input.Count; i++)
        {
            var row = matched[i];
            if (row is null)
            {
                row = new MealSlot { PersonId = personId, Key = NewKey(names[i], rows) };
                rows.Add(row);
                db.MealSlots.Add(row);
                kept.Add(row);
            }
            row.Name = names[i];
            row.Position = i;
            row.IsSnack = input[i].Snack;
            row.ArchivedAt = null;
        }
        foreach (var row in rows.Where(r => !kept.Contains(r) && r.ArchivedAt is null))
            row.ArchivedAt = now;

        await db.SaveChangesAsync(ct);
        return Order(rows.Select(View));
    }

    /// <summary>Lowercase ASCII slug of the name, unique among the person's keys ("Lunch" → "lunch-2" next to Obiad's "lunch").</summary>
    private static string NewKey(string name, IEnumerable<MealSlot> taken)
    {
        var sb = new StringBuilder();
        foreach (var ch in Fold(name))
            sb.Append(ch is >= 'a' and <= 'z' or >= '0' and <= '9' ? ch : '-');
        var slug = string.Join('-', sb.ToString().Split('-', StringSplitOptions.RemoveEmptyEntries));
        if (slug.Length > 30) slug = slug[..30].TrimEnd('-');
        if (slug.Length == 0) slug = "meal";
        var keys = taken.Select(t => t.Key).ToHashSet();
        var candidate = slug;
        for (var n = 2; keys.Contains(candidate); n++) candidate = $"{slug}-{n}";
        return candidate;
    }

    internal static string Fold(string? s) => Pl.Fold((s ?? "").Trim());

    private static MealSlotView View(MealSlot m) => new(m.Key, m.Name, m.IsSnack, m.ArchivedAt is null, m.Position);

    private static List<MealSlotView> Order(IEnumerable<MealSlotView> views) =>
        views.OrderBy(v => v.Active ? 0 : 1).ThenBy(v => v.Position).ThenBy(v => v.Key, StringComparer.Ordinal).ToList();

    internal static MealSlotView? Default(string key) => DefaultByKey.GetValueOrDefault(key);
}

/// <summary>Who calls what in a set of people's days — names, order and the snack flag per (person, key).</summary>
public sealed class SlotDirectory(Dictionary<int, Dictionary<string, MealSlotView>> custom)
{
    public static readonly SlotDirectory Empty = new([]);

    public MealSlotView? Find(int personId, string key) =>
        custom.TryGetValue(personId, out var slots) ? slots.GetValueOrDefault(key) : MealSlots.Default(key);

    /// <summary>The person's active meals in day order.</summary>
    public IReadOnlyList<MealSlotView> Day(int personId) =>
        custom.TryGetValue(personId, out var slots)
            ? slots.Values.Where(v => v.Active).OrderBy(v => v.Position).ToList()
            : MealSlots.Defaults;

    public bool IsSnack(PlanEntry e) => Find(e.PersonId, e.Slot)?.IsSnack ?? false;

    public string Name(int personId, string key) => Find(personId, key)?.Name ?? key;

    public int Position(int personId, string key) => Find(personId, key)?.Position ?? int.MaxValue;
}
