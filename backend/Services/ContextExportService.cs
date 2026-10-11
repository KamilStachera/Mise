using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Mise.Api.Data;
using Mise.Api.Domain;

namespace Mise.Api.Services;

public record ContextExportResult(string Path, List<string> Files, DateTimeOffset ExportedAt);

/// <summary>
/// Writes the full cooking context to a folder you can open with Codex / Claude Code:
/// cookbook.md, pantry.json, shopping.md, supplies.md, plan.md, cooklog.md, recipes/*.md, plus
/// AGENTS.md / CLAUDE.md / api.md (agent instructions + API reference, see
/// <see cref="AgentDocs"/>) and commands/*.md (copyable slash commands). Reading is
/// file-based; all writes go through the REST API. This is the primary AI path.
/// </summary>
public sealed class ContextExportService
{
    private readonly MiseDbContext _db;
    private readonly CookbookMarkdownBuilder _cookbook;
    private readonly string _dir;

    private static readonly JsonSerializerOptions Json = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = true,
        // Emit Polish characters as raw UTF-8 (ł, ó, …) instead of \uXXXX escapes.
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    public ContextExportService(MiseDbContext db, CookbookMarkdownBuilder cookbook,
        IConfiguration config, IHostEnvironment env)
    {
        _db = db;
        _cookbook = cookbook;
        var configured = config["ContextDir"];
        var dir = string.IsNullOrWhiteSpace(configured)
            ? System.IO.Path.Combine(env.ContentRootPath, "..", "context")
            : configured;
        _dir = System.IO.Path.GetFullPath(dir);

        var hostDir = config["HOST_CONTEXT_DIR"];
        HostDirectory = string.IsNullOrWhiteSpace(hostDir) ? null : hostDir.Trim();
        var apiBase = config["PUBLIC_API_BASE"];
        ApiBase = string.IsNullOrWhiteSpace(apiBase) ? "http://localhost:5080/api" : apiBase.Trim();
    }

    public string Directory => _dir;

    /// <summary>Where the context folder lives on the host (for agent prompts); null if not configured.</summary>
    public string? HostDirectory { get; }

    /// <summary>API base as reachable from agents on the host, e.g. http://localhost:5080/api.</summary>
    public string ApiBase { get; }

    public async Task<string> BuildCookbookAsync(CancellationToken ct = default)
    {
        var prefs = await LoadPreferencesAsync(ct);
        var pantry = await _db.PantryItems.AsNoTracking().ToListAsync(ct);
        // Steps feed the air-fryer fallback heuristic on pre-flag recipes.
        var recipes = await _db.Recipes.AsNoTracking().Include(r => r.Steps).ToListAsync(ct);
        var answers = await LoadAnswersAsync(ct);
        return _cookbook.Build(prefs, pantry, recipes, answers);
    }

    /// <summary>
    /// Full markdown of one recipe for the chat system prompt when the user asks
    /// Sous from a recipe page; null when the id is unknown.
    /// </summary>
    public async Task<string?> BuildRecipeFocusAsync(Guid recipeId, CancellationToken ct = default)
    {
        var r = await _db.Recipes.AsNoTracking()
            .Include(x => x.Ingredients).Include(x => x.Steps)
            .FirstOrDefaultAsync(x => x.Id == recipeId, ct);
        if (r is null) return null;
        var md = BuildRecipeMarkdown(r);
        return RecipeScaling.IsScaled(r)
            ? md + $"\nUżytkownik ma ustawione {RecipeScaling.EffectiveServings(r)} porcje (przepis bazowy: {r.Servings}).\n"
            : md;
    }

    // Serialize writers: exports now fire on every data mutation, and two overlapping
    // exports would race on the same files.
    private static readonly SemaphoreSlim Gate = new(1, 1);

    public async Task<ContextExportResult> ExportAsync(CancellationToken ct = default)
    {
        await Gate.WaitAsync(ct);
        try
        {
            return await ExportCoreAsync(ct);
        }
        finally
        {
            Gate.Release();
        }
    }

    private async Task<ContextExportResult> ExportCoreAsync(CancellationToken ct)
    {
        var prefs = await LoadPreferencesAsync(ct);
        var pantry = (await _db.PantryItems.AsNoTracking().ToListAsync(ct))
            .OrderBy(p => p.Category).ThenBy(p => p.Name, Pl.Comparer).ToList();
        var recipes = await _db.Recipes.AsNoTracking()
            .Include(r => r.Ingredients.OrderBy(i => i.Order))
            .Include(r => r.Steps.OrderBy(s => s.Order))
            .AsSplitQuery()
            .ToListAsync(ct);
        var shopping = (await _db.ShoppingItems.AsNoTracking().ToListAsync(ct))
            .OrderBy(s => s.Category).ThenBy(s => s.Name, Pl.Comparer).ToList();
        var supplies = (await _db.SupplyItems.AsNoTracking().ToListAsync(ct))
            .OrderBy(s => s.Category).ThenBy(s => s.Name, Pl.Comparer).ToList();
        // Same ranking as SupplyService.HotAsync, minus the "already on the list" filter:
        // an agent reading the file wants the full quick-add vocabulary.
        var supplyFavorites = (await _db.SupplyFavorites.AsNoTracking()
                .Where(f => !f.Hidden).ToListAsync(ct))
            .Select(f => new HotSupply(f, SupplyService.ScoreOf(f, DateTimeOffset.UtcNow)))
            .OrderByDescending(h => h.Favorite.Pinned)
            .ThenByDescending(h => h.Score)
            .ThenBy(h => h.Favorite.Name, Pl.Comparer)
            .Select(h => h.Favorite)
            .Take(SupplyService.HotCap)
            .ToList();
        var answers = await LoadAnswersAsync(ct);
        var cookLog = await _db.CookLog.AsNoTracking()
            .OrderByDescending(e => e.CookedAt).ThenByDescending(e => e.CreatedAt)
            .Take(CookLogExportCap)
            .ToListAsync(ct);
        var planFrom = StartOfWeek(DateOnly.FromDateTime(DateTime.Today));
        var planTo = planFrom.AddDays(14);
        var plan = await _db.PlanEntries.AsNoTracking()
            .Where(e => e.Date >= planFrom && e.Date < planTo)
            .OrderBy(e => e.Date)
            .ToListAsync(ct);

        System.IO.Directory.CreateDirectory(_dir);
        var recipesDir = System.IO.Path.Combine(_dir, "recipes");
        System.IO.Directory.CreateDirectory(recipesDir);
        System.IO.Directory.CreateDirectory(System.IO.Path.Combine(_dir, "commands"));

        var files = new List<string>();

        await WriteAsync("cookbook.md", _cookbook.Build(prefs, pantry, recipes, answers), files, ct);

        var pantryJson = JsonSerializer.Serialize(pantry.Select(p => new
        {
            nazwa = p.Name,
            kategoria = CookbookMarkdownBuilder.CategoryLabel(p.Category),
            jednostka = Features.Mapping.UnitString(p.Unit),
            ilosc = p.Quantity,
            iloscDoPlanowania = StockReliability.PlanningQuantity(p),
            pewnosc = StockReliability.Confidence(p),
            stanZaobserwowany = p.ReliabilityUpdatedAt,
            progMalo = p.LowThreshold,
            status = CookbookMarkdownBuilder.StatusLabel(Features.Mapping.StatusOf(p)),
            aliasy = p.Aliases.Split(';',
                StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries),
        }), Json);
        await WriteAsync("pantry.json", pantryJson, files, ct);

        await WriteAsync("shopping.md", BuildShoppingMarkdown(shopping), files, ct);
        await WriteAsync("supplies.md", BuildSuppliesMarkdown(supplies, supplyFavorites), files, ct);
        await WriteAsync("plan.md", BuildPlanMarkdown(plan, recipes, planFrom), files, ct);
        await WriteAsync("cooklog.md", BuildCookLogMarkdown(cookLog), files, ct);
        await WriteAsync("AGENTS.md", AgentDocs.AgentsMd(ApiBase), files, ct);
        await WriteAsync("CLAUDE.md", AgentDocs.AgentsMd(ApiBase), files, ct);
        await WriteAsync("api.md", AgentDocs.ApiMd(ApiBase), files, ct);

        // Slash-command files the user can copy to ~/.claude/commands and ~/.codex/prompts.
        // Only these known names are overwritten; the folder itself is never wiped.
        var ctxForCommands = HostDirectory ?? AgentDocs.ContextDirToken;
        foreach (var (name, content) in AgentDocs.CommandFiles(ApiBase, ctxForCommands))
            await WriteAsync(System.IO.Path.Combine("commands", name), content, files, ct);

        // refresh recipes/ folder (the API is the only write path, so a full
        // wipe-and-rewrite keeps deleted recipes from lingering)
        foreach (var existing in System.IO.Directory.GetFiles(recipesDir, "*.md"))
            System.IO.File.Delete(existing);

        var logByRecipe = cookLog.Where(e => e.RecipeId is not null)
            .GroupBy(e => e.RecipeId!.Value)
            .ToDictionary(g => g.Key, g => g.Take(RecipeHistoryCap).ToList());

        var usedSlugs = new HashSet<string>();
        foreach (var r in recipes)
        {
            var slug = UniqueSlug(r.Title, usedSlugs);
            var rel = System.IO.Path.Combine("recipes", slug + ".md");
            logByRecipe.TryGetValue(r.Id, out var history);
            await WriteAsync(rel, BuildRecipeMarkdown(r, history), files, ct);
        }

        return new ContextExportResult(_dir, files, DateTimeOffset.UtcNow);
    }

    // Caps keep cooklog.md and per-recipe history from growing unbounded (the
    // cookbook also feeds the in-app chat system prompt).
    private const int CookLogExportCap = 50;
    private const int RecipeHistoryCap = 10;

    private static DateOnly StartOfWeek(DateOnly date)
    {
        var diff = ((int)date.DayOfWeek + 6) % 7;   // Monday-based
        return date.AddDays(-diff);
    }

    private async Task WriteAsync(string relativePath, string content, List<string> files, CancellationToken ct)
    {
        var full = System.IO.Path.Combine(_dir, relativePath);
        await System.IO.File.WriteAllTextAsync(full, content, new UTF8Encoding(false), ct);
        files.Add(relativePath.Replace('\\', '/'));
    }

    private async Task<Preferences> LoadPreferencesAsync(CancellationToken ct)
    {
        var prefs = await _db.Preferences.AsNoTracking()
            .Include(p => p.Equipment)
            .OrderBy(p => p.Id)
            .FirstOrDefaultAsync(ct);
        return prefs ?? new Preferences();
    }

    private async Task<Dictionary<string, string>> LoadAnswersAsync(CancellationToken ct) =>
        await _db.ProfileAnswers.AsNoTracking().ToDictionaryAsync(a => a.Key, a => a.Value, ct);

    private static string BuildRecipeMarkdown(Recipe r, List<CookLogEntry>? history = null)
    {
        var sb = new StringBuilder();
        sb.AppendLine($"# {r.Title}");
        sb.AppendLine();
        var header = new List<string>
        {
            CookbookMarkdownBuilder.SourceLabel(r.Source),
            $"{r.TimeMinutes} min",
            $"{r.Servings} porcje",
            r.Difficulty,
        };
        if (r.DishType is DishType d) header.Add(CookbookMarkdownBuilder.DishTypeLabel(d));
        if (r.Cuisine is Cuisine c) header.Add($"Kuchnia {CookbookMarkdownBuilder.CuisineLabel(c)}");
        sb.AppendLine($"> {string.Join(" · ", header)}");
        if (CookbookMarkdownBuilder.MacroSummary(r) is string macros)
            sb.AppendLine($"> Wartości odżywcze (na porcję): {macros}");
        sb.AppendLine();
        if (!string.IsNullOrWhiteSpace(r.Blurb))
        {
            sb.AppendLine(r.Blurb.Trim());
            sb.AppendLine();
        }
        sb.AppendLine("## Składniki");
        var emittedAlternativeGroups = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var i in r.Ingredients.OrderBy(i => i.Order))
        {
            var isAlternative = !string.IsNullOrWhiteSpace(i.AlternativeGroup);
            var followsAlternative = isAlternative
                && !emittedAlternativeGroups.Add(i.AlternativeGroup!.Trim());
            var name = followsAlternative ? $"lub: {i.Name}" : i.Name;
            sb.AppendLine(string.IsNullOrWhiteSpace(i.DisplayText)
                ? $"- {(followsAlternative ? "lub: " : "")}{Features.Mapping.IngredientDisplayText(i)}"
                : $"- **{name}** — {i.DisplayText.Trim()}");
        }
        sb.AppendLine();
        sb.AppendLine("## Przygotowanie");
        var n = 1;
        foreach (var s in r.Steps.OrderBy(s => s.Order))
            sb.AppendLine($"{n++}. {s.Text}");
        if (!string.IsNullOrWhiteSpace(r.Tip))
        {
            sb.AppendLine();
            sb.AppendLine("## Wskazówki");
            sb.AppendLine(r.Tip.Trim());
        }
        if (history is { Count: > 0 })
        {
            sb.AppendLine();
            sb.AppendLine("## Historia");
            foreach (var e in history)
                sb.AppendLine(FormatLogLine(e, withDish: false));
        }
        return sb.ToString().TrimEnd() + "\n";
    }

    private static string FormatLogLine(CookLogEntry e, bool withDish)
    {
        var sb = new StringBuilder($"- {e.CookedAt:yyyy-MM-dd}");
        if (withDish) sb.Append($" · **{e.DishName}**");
        if (e.Rating is int rating) sb.Append($" · ocena {rating}/5");
        if (!string.IsNullOrWhiteSpace(e.Note)) sb.Append($" — {e.Note.Trim()}");
        return sb.ToString();
    }

    private static string BuildCookLogMarkdown(List<CookLogEntry> entries)
    {
        var sb = new StringBuilder();
        sb.AppendLine("# Historia gotowania");
        sb.AppendLine();
        if (entries.Count == 0)
        {
            sb.AppendLine("_Jeszcze nic nie odnotowano._");
            return sb.ToString();
        }
        sb.AppendLine("Wpisy od najnowszych (maks. 50). Traktuj oceny i notatki");
        sb.AppendLine("jako feedback do kolejnych propozycji.");
        sb.AppendLine();
        foreach (var e in entries)
            sb.AppendLine(FormatLogLine(e, withDish: true));
        return sb.ToString().TrimEnd() + "\n";
    }

    private static string BuildPlanMarkdown(List<PlanEntry> entries, List<Recipe> recipes, DateOnly from)
    {
        var titleById = recipes.ToDictionary(r => r.Id, r => r.Title);
        var byDate = entries.ToLookup(e => e.Date);
        var pl = System.Globalization.CultureInfo.GetCultureInfo("pl-PL");

        var sb = new StringBuilder();
        sb.AppendLine("# Plan posiłków");
        sb.AppendLine();
        sb.AppendLine("Bieżący i przyszły tydzień. Wpisy zmieniaj przez `PUT /plan/entry` (patrz `api.md`).");

        for (var week = 0; week < 2; week++)
        {
            var weekStart = from.AddDays(week * 7);
            sb.AppendLine();
            sb.AppendLine($"## {(week == 0 ? "Ten tydzień" : "Przyszły tydzień")} ({weekStart:dd.MM} – {weekStart.AddDays(6):dd.MM})");
            for (var d = 0; d < 7; d++)
            {
                var date = weekStart.AddDays(d);
                var dayName = pl.DateTimeFormat.GetDayName(date.DayOfWeek);
                dayName = char.ToUpper(dayName[0], pl) + dayName[1..];   // pl-PL day names are lowercase
                var dayEntries = byDate[date]
                    .OrderBy(e => e.Slot switch { MealSlot.Breakfast => 0, MealSlot.Lunch => 1, _ => 2 })
                    .ToList();
                if (dayEntries.Count == 0)
                {
                    sb.AppendLine($"- {dayName} {date:dd.MM}: —");
                    continue;
                }
                foreach (var e in dayEntries)
                {
                    var slot = SlotLabel(e.Slot);
                    var what = e.RecipeId is Guid rid && titleById.TryGetValue(rid, out var t)
                        ? $"{t} (zapisany przepis)"
                        : e.Title;
                    var note = string.IsNullOrWhiteSpace(e.Note) ? "" : $" — {e.Note.Trim()}";
                    sb.AppendLine($"- {dayName} {date:dd.MM}, {slot}: {what}{note}");
                }
            }
        }
        return sb.ToString().TrimEnd() + "\n";
    }

    public static string SlotLabel(MealSlot s) => s switch
    {
        MealSlot.Breakfast => "śniadanie",
        MealSlot.Dinner => "kolacja",
        _ => "obiad",
    };

    private static string BuildShoppingMarkdown(List<ShoppingItem> items)
    {
        var sb = new StringBuilder();
        sb.AppendLine("# Lista zakupów");
        sb.AppendLine();
        if (items.Count == 0)
        {
            sb.AppendLine("_Nic do kupienia._");
            return sb.ToString();
        }
        foreach (var s in items)
        {
            var box = s.Checked ? "[x]" : "[ ]";
            var qty = s.Quantity is decimal q && s.Unit is PantryUnit u
                ? $" — {q:0.##} {CookbookMarkdownBuilder.UnitLabel(u)}"
                : "";
            var reason = string.IsNullOrWhiteSpace(s.Reason) ? "" : $" — {s.Reason}";
            sb.AppendLine($"- {box} {s.Name}{qty}{reason}");
        }
        return sb.ToString().TrimEnd() + "\n";
    }

    private static string SupplyCategoryLabel(SupplyCategory c) => c switch
    {
        SupplyCategory.Cleaning => "Chemia",
        SupplyCategory.Hygiene => "Higiena",
        SupplyCategory.Paper => "Papier",
        SupplyCategory.Kitchen => "Kuchnia",
        SupplyCategory.Pets => "Zwierzęta",
        _ => "Inne",
    };

    private static string BuildSuppliesMarkdown(List<SupplyItem> items, List<SupplyFavorite> hot)
    {
        var sb = new StringBuilder();
        sb.AppendLine("# Dom i chemia");
        sb.AppendLine();
        sb.AppendLine("_Lista niezależna od spiżarni i od listy zakupów spożywczych._");
        sb.AppendLine();

        if (items.Count == 0)
        {
            sb.AppendLine("_Nic do kupienia._");
        }
        else
        {
            foreach (var group in items.GroupBy(s => s.Category).OrderBy(g => g.Key))
            {
                sb.AppendLine($"## {SupplyCategoryLabel(group.Key)}");
                sb.AppendLine();
                foreach (var s in group)
                    sb.AppendLine($"- {(s.Checked ? "[x]" : "[ ]")} {s.Name}");
                sb.AppendLine();
            }
        }

        if (hot.Count > 0)
        {
            sb.AppendLine();
            sb.AppendLine("## Częste");
            sb.AppendLine();
            sb.AppendLine("Rzeczy, które lądują tu najczęściej — dopisuj je po nazwie:");
            sb.AppendLine();
            foreach (var f in hot)
                sb.AppendLine($"- {f.Name}{(f.Pinned ? " (przypięte)" : "")}");
        }

        return sb.ToString().TrimEnd() + "\n";
    }

    private static string UniqueSlug(string title, HashSet<string> used)
    {
        var baseSlug = Slugify(title);
        var slug = baseSlug;
        var i = 2;
        while (!used.Add(slug)) slug = $"{baseSlug}-{i++}";
        return slug;
    }

    private static string Slugify(string s)
    {
        s = s.ToLowerInvariant();
        s = Regex.Replace(s, @"[^a-z0-9]+", "-").Trim('-');
        return string.IsNullOrEmpty(s) ? "recipe" : s;
    }
}
