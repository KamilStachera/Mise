using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Mise.Api.Data;
using Mise.Api.Domain;

namespace Mise.Api.Services;

/// <summary>One hot-list row: a learned favorite ranked for quick re-adding.</summary>
public readonly record struct HotSupply(SupplyFavorite Favorite, double Score);

/// <summary>
/// The household supplies list. Every rule that is not plain CRUD lives here rather than in
/// the endpoint lambdas, because the test project has no WebApplicationFactory — only
/// Services/ classes are reachable from tests.
/// </summary>
public class SupplyService
{
    /// <summary>How many chips the UI can show without the row turning into clutter.</summary>
    public const int HotCap = 8;

    /// <summary>
    /// Days after which a tally counts for half. Household restocking runs on a ~monthly
    /// rhythm, so a burst from last year should fade rather than sit at the top forever.
    /// </summary>
    private const double DecayDays = 45.0;

    private readonly MiseDbContext _db;

    public SupplyService(MiseDbContext db) => _db = db;

    /// <summary>
    /// Identity key for a supply name. Reuses the ingredient normalizer for its
    /// diacritic folding and punctuation stripping — note it does not stem, which is
    /// exactly what an identity key wants ("chusteczki" must not collapse into "chustka").
    /// </summary>
    public static string Key(string name) => IngredientMatcher.Normalize(name);

    // Specific rules first, so "papier toaletowy" is Paper and not caught by a looser rule.
    private static readonly (SupplyCategory Category, Regex Pattern)[] Rules =
    {
        (SupplyCategory.Paper, new Regex(@"papier toalet|recznik\w* papier|papier kuchen|chustecz|serwetk|papier do pieczenia")),
        (SupplyCategory.Pets, new Regex(@"karma|zwierz|dla kota|dla psa|kuweta|zwirek|smakolyk")),
        (SupplyCategory.Hygiene, new Regex(@"mydlo|szampon|odzywk|zel pod prysznic|pasta do zeb|szczoteczk|nic dentyst|plyn do plukania ust|dezodorant|golen|podpask|tampon|pielucha|krem|balsam|wacik|patyczk")),
        (SupplyCategory.Cleaning, new Regex(@"plyn do|proszek do prania|kapsulk do prania|plyn do plukania|tabletk do zmyw|nabloszcz|odkamien|wybielacz|detergent|myd(e|l)o w plynie|srodek|czyszcz|udrazniacz|odswiezacz")),
        (SupplyCategory.Kitchen, new Regex(@"worki na smieci|folia alumini|folia spozywcz|papier sniadan|gabk|zmywak|sciereczk|reczniki kuchen|rekawic|strunow|zapalk|swieczk|baterie|zarowk|filtr do wody")),
    };

    /// <summary>Best-effort category from the name; Other when nothing matches.</summary>
    public static SupplyCategory Guess(string name)
    {
        var normalized = Key(name);
        if (normalized.Length == 0) return SupplyCategory.Other;
        foreach (var (category, pattern) in Rules)
            if (pattern.IsMatch(normalized)) return category;
        return SupplyCategory.Other;
    }

    /// <summary>
    /// Put a name on the list. Adding something already on the list is a safe no-op (a chip
    /// tap and an agent retry must not duplicate); adding something already checked off
    /// un-checks it instead of creating a second row.
    /// </summary>
    public async Task<SupplyItem> AddAsync(string name, SupplyCategory? category,
        CancellationToken ct = default)
    {
        var trimmed = name.Trim();
        var key = Key(trimmed);
        var existing = await _db.SupplyItems.ToListAsync(ct);
        var onList = existing.FirstOrDefault(s => Key(s.Name) == key && !s.Checked);
        if (onList is not null) return onList;

        var resolved = category ?? Guess(trimmed);
        var checkedOff = existing.FirstOrDefault(s => Key(s.Name) == key);
        if (checkedOff is not null)
        {
            checkedOff.Checked = false;
            checkedOff.Category = resolved;
            await BumpAsync(trimmed, key, resolved, ct);
            await _db.SaveChangesAsync(ct);
            return checkedOff;
        }

        var item = new SupplyItem { Name = trimmed, Category = resolved };
        _db.SupplyItems.Add(item);
        await BumpAsync(trimmed, key, resolved, ct);
        await _db.SaveChangesAsync(ct);
        return item;
    }

    private async Task BumpAsync(string name, string key, SupplyCategory category,
        CancellationToken ct)
    {
        var favorite = await _db.SupplyFavorites.FirstOrDefaultAsync(f => f.NormalizedName == key, ct);
        if (favorite is null)
        {
            favorite = new SupplyFavorite { NormalizedName = key };
            _db.SupplyFavorites.Add(favorite);
        }
        favorite.Name = name;
        favorite.Category = category;
        favorite.AddCount++;
        favorite.LastAddedAt = DateTimeOffset.UtcNow;
        // Re-adding something the user once dismissed is them changing their mind.
        favorite.Hidden = false;
    }

    /// <summary>
    /// The quick-add chips: pinned first, then by recency-decayed add count, then Polish
    /// name. Hidden entries and anything already on the list are dropped — a chip that
    /// does nothing is noise. Seeded suggestions have AddCount 0, so they score 0 and
    /// naturally fill the tail of the row until real usage displaces them.
    /// </summary>
    public async Task<List<HotSupply>> HotAsync(int cap = HotCap, CancellationToken ct = default)
    {
        var favorites = await _db.SupplyFavorites.AsNoTracking()
            .Where(f => !f.Hidden).ToListAsync(ct);
        var onList = (await _db.SupplyItems.AsNoTracking().Where(s => !s.Checked).ToListAsync(ct))
            .Select(s => Key(s.Name)).ToHashSet();

        return Rank(favorites.Where(f => !onList.Contains(f.NormalizedName))).Take(cap).ToList();
    }

    /// <summary>
    /// Every learned entry, hidden ones included, in the same order. This is what the
    /// "manage" panel needs: the capped hot list cannot show something to unhide (hidden
    /// entries are excluded from it by definition) or let you pin something ranked 9th.
    /// </summary>
    public async Task<List<HotSupply>> AllFavoritesAsync(CancellationToken ct = default)
        => Rank(await _db.SupplyFavorites.AsNoTracking().ToListAsync(ct)).ToList();

    private static IEnumerable<HotSupply> Rank(IEnumerable<SupplyFavorite> favorites)
    {
        var now = DateTimeOffset.UtcNow;
        return favorites
            .Select(f => new HotSupply(f, ScoreOf(f, now)))
            .OrderByDescending(h => h.Favorite.Pinned)
            .ThenByDescending(h => h.Score)
            .ThenBy(h => h.Favorite.Name, Pl.Comparer);
    }

    /// <summary>Add count, halved roughly every <see cref="DecayDays"/> since the last add.</summary>
    public static double ScoreOf(SupplyFavorite f, DateTimeOffset now)
    {
        if (f.AddCount <= 0) return 0;
        if (f.LastAddedAt is not DateTimeOffset last) return f.AddCount;
        var days = Math.Max(0, (now - last).TotalDays);
        return f.AddCount / (1 + days / DecayDays);
    }
}
