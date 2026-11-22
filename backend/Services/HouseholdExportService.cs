using System.IO.Compression;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Mise.Api.Data;
using Mise.Api.Domain;
using Mise.Api.Features;

namespace Mise.Api.Services;

/// <summary>
/// Builds a portable, strictly tenant-scoped ZIP backup of a single household's culinary, diary,
/// body, training, and photo data. Credentials (API keys, Strava OAuth tokens, HC webhook secrets,
/// invite codes) are intentionally excluded.
/// </summary>
public sealed class HouseholdExportService(MiseDbContext db, ContextExportService contextExport, RecipeImageStore images)
{
    private static readonly JsonSerializerOptions Json = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = true,
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    public async Task<Stream> CreateArchiveStreamAsync(int householdId, CancellationToken ct = default)
    {
        var household = await db.Households.AsNoTracking().FirstAsync(h => h.Id == householdId, ct);
        var people = await db.People.AsNoTracking().OrderBy(p => p.Id)
            .Select(p => new { p.Id, p.Name, Role = p.Role.ToString().ToLowerInvariant(), p.CreatedAt })
            .ToListAsync(ct);

        var recipes = await db.Recipes.AsNoTracking()
            .Include(r => r.Ingredients.OrderBy(i => i.Order))
            .Include(r => r.Steps.OrderBy(s => s.Order))
            .Include(r => r.Images.OrderBy(img => img.CreatedAt))
            .AsSplitQuery()
            .OrderBy(r => r.CreatedAt).ThenBy(r => r.Id)
            .ToListAsync(ct);
        var pantry = await db.PantryItems.AsNoTracking().OrderBy(p => p.Category).ThenBy(p => p.Name).ToListAsync(ct);
        var shopping = await db.ShoppingItems.AsNoTracking().OrderBy(s => s.Category).ThenBy(s => s.Name).ToListAsync(ct);
        var supplies = await db.SupplyItems.AsNoTracking().OrderBy(s => s.Category).ThenBy(s => s.Name).ToListAsync(ct);
        var supplyFavs = await db.SupplyFavorites.AsNoTracking().OrderByDescending(f => f.AddCount).ToListAsync(ct);
        var cooks = await db.Cooks.AsNoTracking().OrderByDescending(c => c.Date).ToListAsync(ct);
        var mealSlots = await db.MealSlots.AsNoTracking().OrderBy(m => m.PersonId).ThenBy(m => m.Position).ToListAsync(ct);
        var planEntries = await db.PlanEntries.AsNoTracking().OrderByDescending(e => e.Date).ThenBy(e => e.Slot).ToListAsync(ct);
        var cookLog = await db.CookLog.AsNoTracking().OrderByDescending(c => c.CookedAt).ToListAsync(ct);
        var prefs = await db.Preferences.AsNoTracking().Include(p => p.Equipment).OrderBy(p => p.Id).FirstOrDefaultAsync(ct);
        var answers = await db.ProfileAnswers.AsNoTracking().OrderBy(a => a.Key).ToDictionaryAsync(a => a.Key, a => a.Value, ct);
        var bodyProfiles = await db.BodyProfiles.AsNoTracking().OrderBy(b => b.PersonId).ToListAsync(ct);
        var weights = await db.WeightEntries.AsNoTracking().OrderByDescending(w => w.Date).ToListAsync(ct);
        var caterings = await db.Caterings.AsNoTracking().OrderBy(c => c.PersonId).ToListAsync(ct);
        var cateringPauses = await db.CateringPauses.AsNoTracking().OrderByDescending(p => p.From).ToListAsync(ct);
        var workouts = await db.Workouts.AsNoTracking().OrderByDescending(w => w.Date).ToListAsync(ct);
        var trainingProfiles = await db.TrainingProfiles.AsNoTracking().OrderBy(t => t.PersonId).ToListAsync(ct);
        var trainingPrograms = await db.TrainingPrograms.AsNoTracking()
            .Include(p => p.Days).ThenInclude(d => d.Exercises)
            .AsSplitQuery()
            .OrderByDescending(p => p.CreatedAt)
            .ToListAsync(ct);
        var trainingSessions = (await db.TrainingSessions.AsNoTracking()
            .Include(s => s.Sets)
            .AsSplitQuery()
            .ToListAsync(ct))
            .OrderByDescending(s => s.Date).ThenByDescending(s => s.StartedAt)
            .ToList();

        var cookbookMd = await contextExport.BuildCookbookAsync(ct);

        var tmpPath = Path.Combine(Path.GetTempPath(), $"pichci-export-{Guid.NewGuid():N}.zip");
        var stream = new FileStream(tmpPath, FileMode.Create, FileAccess.ReadWrite, FileShare.None, 81920,
            FileOptions.Asynchronous | FileOptions.DeleteOnClose);

        try
        {
            using (var zip = new ZipArchive(stream, ZipArchiveMode.Create, leaveOpen: true))
            {
                var exportedAt = DateTimeOffset.UtcNow;
                await WriteTextAsync(zip, "README.txt",
                    $"Kopia zapasowa Pichci — {household.Name}\n" +
                    $"Wygenerowano: {exportedAt:yyyy-MM-dd HH:mm:ss zzz}\n" +
                    $"Przepisy: {recipes.Count}, Spiżarnia: {pantry.Count}, Wpisy planu/dziennika: {planEntries.Count}\n\n" +
                    "Zawartość archiwum:\n" +
                    "- cookbook.md — podsumowanie profilu i kuchni dla asystenta\n" +
                    "- recipes/*.md + recipes.json — wszystkie przepisy\n" +
                    "- images/* — oryginalne zdjęcia przepisów\n" +
                    "- pantry.json, shopping.json, supplies.json — spiżarnia i listy zakupów\n" +
                    "- plan.json, cooklog.json — plan posiłków, dziennik i historia gotowania\n" +
                    "- preferences.json, body.json, training.json — profil, cele, wagi, catering i trening\n", ct);

                await WriteTextAsync(zip, "cookbook.md", cookbookMd, ct);

                var usedSlugs = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                foreach (var r in recipes)
                {
                    var slug = UniqueSlug(r.Title, usedSlugs);
                    await WriteTextAsync(zip, $"recipes/{slug}.md", ContextExportService.BuildRecipeMarkdown(r), ct);
                }

                await WriteJsonAsync(zip, "recipes.json", recipes.Select(r => new
                {
                    r.Id, r.Title, Source = Mapping.SourceString(r.Source), r.SourceName,
                    r.TimeMinutes, r.Servings, r.Difficulty, r.Tint, r.Blurb, r.Tip,
                    DishType = Mapping.DishTypeString(r.DishType), Cuisine = Mapping.CuisineString(r.Cuisine),
                    UsesAirFryer = AirFryer.Uses(r), r.IsFavorite, r.Tags,
                    r.KcalPerServing, r.ProteinGrams, r.FatGrams, r.CarbGrams,
                    r.ImagePath, Images = r.Images.Select(i => new { i.Id, i.Path, i.CreatedAt }),
                    Ingredients = r.Ingredients.Select(i => new
                    {
                        i.Name, i.Quantity, i.DisplayText, i.AlternativeGroup, i.Order,
                        i.AmountValue, AmountUnit = i.AmountUnit is PantryUnit u ? Mapping.UnitString(u) : null,
                    }),
                    Steps = r.Steps.Select(s => s.Text),
                    r.CreatedAt, r.UpdatedAt,
                }), ct);

                await WriteJsonAsync(zip, "pantry.json", pantry.Select(p => new
                {
                    p.Id, p.Name, Category = p.Category.ToString(), Unit = Mapping.UnitString(p.Unit),
                    p.Quantity, p.LowThreshold, p.Aliases, p.UpdatedAt,
                }), ct);

                await WriteJsonAsync(zip, "shopping.json", shopping.Select(s => new
                {
                    s.Id, s.Name, s.Category, s.Reason, s.Checked, Origin = s.Origin.ToString().ToLowerInvariant(),
                    s.Quantity, Unit = s.Unit is PantryUnit u ? Mapping.UnitString(u) : null,
                }), ct);

                await WriteJsonAsync(zip, "supplies.json", new
                {
                    items = supplies.Select(s => new { s.Id, s.Name, Category = Mapping.SupplyCategoryString(s.Category), s.Checked }),
                    favorites = supplyFavs.Select(f => new { f.Name, Category = Mapping.SupplyCategoryString(f.Category), f.AddCount, f.Pinned, f.Hidden }),
                }, ct);

                await WriteJsonAsync(zip, "plan.json", new
                {
                    people,
                    meals = mealSlots.Select(m => new { m.PersonId, m.Key, m.Name, m.Position, m.IsSnack, m.ArchivedAt }),
                    cooks = cooks.Select(c => new { c.Id, c.PersonId, c.RecipeId, c.Title, c.Date, c.Portions, c.DiscardedPortions }),
                    entries = planEntries.Select(e => new
                    {
                        e.Id, e.PersonId, e.Date, e.Slot, e.RecipeId, e.Title, e.Note,
                        e.Portions, e.Grams, e.Kcal, e.Protein, e.Fat, e.Carbs, e.EatenAt, e.CookId, e.IsLeftover, e.IsCatering,
                    }),
                }, ct);

                await WriteJsonAsync(zip, "cooklog.json", cookLog.Select(c => new
                {
                    c.Id, c.RecipeId, c.DishName, c.CookedAt, c.Rating, c.Note, c.CreatedAt,
                }), ct);

                await WriteJsonAsync(zip, "preferences.json", new
                {
                    household = new { household.Id, household.Name, household.CreatedAt },
                    preferences = prefs is null ? null : new
                    {
                        prefs.HouseholdSummary, prefs.HouseholdDetail, prefs.SkillSummary, prefs.SkillDetail,
                        prefs.TasteCuisines, prefs.AvoidDietary, prefs.EquipmentNote,
                        equipment = prefs.Equipment.Select(e => new { e.Name, e.Favorite }),
                    },
                    questionnaireAnswers = answers,
                }, ct);

                await WriteJsonAsync(zip, "body.json", new
                {
                    profiles = bodyProfiles.Select(b => new
                    {
                        b.PersonId, Sex = b.Sex.ToString().ToLowerInvariant(), b.BirthYear, b.HeightCm,
                        b.GoalWeightKg, ActivityLevel = b.ActivityLevel.ToString().ToLowerInvariant(),
                        b.PaceKgPerWeek, b.TargetKcalOverride, b.ProteinTargetOverride, b.ActivityAddBackPercent,
                    }),
                    weights = weights.Select(w => new { w.PersonId, w.Date, w.Kg, Source = w.Source.ToString().ToLowerInvariant() }),
                    caterings = caterings.Select(c => new
                    {
                        c.PersonId, c.Enabled, c.Kcal, c.Protein, c.Fat, c.Carbs, c.Weekdays, c.StartDate, c.SplitMeals,
                    }),
                    cateringPauses = cateringPauses.Select(p => new { p.PersonId, p.From, p.To, p.Note }),
                    workouts = workouts.Select(w => new { w.PersonId, w.Date, w.Minutes, w.Kcal, w.Type, Source = w.Source.ToString().ToLowerInvariant() }),
                }, ct);

                await WriteJsonAsync(zip, "training.json", new
                {
                    profiles = trainingProfiles.Select(t => new
                    {
                        t.PersonId, Goal = t.Goal.ToString().ToLowerInvariant(), Level = t.Level.ToString().ToLowerInvariant(),
                        t.DaysPerWeek, t.MinutesPerSession, t.PreferredWeekdays, Location = t.Location.ToString().ToLowerInvariant(),
                        t.HomeEquipment, t.Styles, t.Limitations, t.Dislikes, t.Notes,
                    }),
                    programs = trainingPrograms.Select(p => new
                    {
                        p.Id, p.PersonId, p.Name, p.Description, p.Rationale, p.StartDate, p.Weeks,
                        Status = p.Status.ToString().ToLowerInvariant(), p.CreatedBy,
                        days = p.Days.OrderBy(d => d.Week).ThenBy(d => d.Weekday).Select(d => new
                        {
                            d.Week, d.Weekday, d.Name, Kind = d.Kind.ToString().ToLowerInvariant(),
                            Location = d.Location.ToString().ToLowerInvariant(), d.Notes,
                            d.VideoYoutubeId, d.VideoTitle, d.VideoMinutes, d.WorkoutType,
                            exercises = d.Exercises.OrderBy(e => e.Order).Select(e => new
                            {
                                e.Order, e.ExerciseId, e.Sets, e.RepsMin, e.RepsMax, e.Seconds,
                                e.RestSeconds, e.TargetKg, e.Notes, e.SupersetGroup,
                            }),
                        }),
                    }),
                    sessions = trainingSessions.Select(s => new
                    {
                        s.Id, s.PersonId, s.ProgramId, s.ProgramDayId, s.Name,
                        Kind = s.Kind.ToString().ToLowerInvariant(), s.Date, s.StartedAt, s.FinishedAt,
                        s.DurationMinutes, s.EstimatedKcal, s.Notes, s.WorkoutId,
                        sets = s.Sets.OrderBy(x => x.ExerciseOrder).ThenBy(x => x.SetNumber).Select(x => new
                        {
                            x.ExerciseId, x.ExerciseOrder, x.SetNumber,
                            x.TargetRepsMin, x.TargetRepsMax, x.TargetSeconds, x.TargetKg,
                            x.RestSeconds, x.SupersetGroup, x.Reps, x.Seconds, x.WeightKg,
                            x.Completed, x.CompletedAt, x.Notes, x.IsPr,
                        }),
                    }),
                }, ct);

                // Include original recipe photos owned by this household (stored without re-compression).
                var seenPhotos = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                foreach (var fileName in recipes.SelectMany(r => r.Images.Select(i => i.Path).Append(r.ImagePath ?? ""))
                             .Where(p => !string.IsNullOrWhiteSpace(p)))
                {
                    if (!seenPhotos.Add(fileName)) continue;
                    var path = images.GetOriginalPath(fileName);
                    if (path is null) continue;
                    var entry = zip.CreateEntry($"images/{fileName}", CompressionLevel.NoCompression);
                    await using var entryStream = entry.Open();
                    await using var src = File.OpenRead(path);
                    await src.CopyToAsync(entryStream, ct);
                }
            }

            stream.Position = 0;
            return stream;
        }
        catch
        {
            await stream.DisposeAsync();
            throw;
        }
    }

    private static async Task WriteTextAsync(ZipArchive zip, string path, string text, CancellationToken ct)
    {
        var entry = zip.CreateEntry(path, CompressionLevel.Optimal);
        await using var s = entry.Open();
        var bytes = new UTF8Encoding(false).GetBytes(text);
        await s.WriteAsync(bytes, ct);
    }

    private static Task WriteJsonAsync(ZipArchive zip, string path, object value, CancellationToken ct)
        => WriteTextAsync(zip, path, JsonSerializer.Serialize(value, Json), ct);

    private static string UniqueSlug(string title, HashSet<string> used)
    {
        var baseSlug = ContextExportService.Slugify(title);
        var slug = baseSlug;
        var i = 2;
        while (!used.Add(slug)) slug = $"{baseSlug}-{i++}";
        return slug;
    }
}
