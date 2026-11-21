using Microsoft.EntityFrameworkCore;
using Mise.Api.Data;
using Mise.Api.Domain;
using Mise.Api.Services;

namespace Mise.Api.Features;

public static class PreferencesEndpoints
{
    public static RouteGroupBuilder MapPreferences(this RouteGroupBuilder api)
    {
        var g = api.MapGroup("/preferences").WithTags("Preferences");

        g.MapGet("/", async (MiseDbContext db) =>
        {
            var prefs = await db.Preferences.AsNoTracking()
                .Include(p => p.Equipment)
                .OrderBy(p => p.Id)
                .FirstOrDefaultAsync();
            return Results.Ok(prefs is null ? EmptyDto : ToDto(prefs));
        });

        g.MapPut("/", async (PreferencesDto input, MiseDbContext db, ContextExportService export) =>
        {
            var equipment = input.Equipment ?? new();
            if (equipment.Count > 100)
                return Results.BadRequest(new { error = "Zbyt wiele pozycji sprzętu (maks. 100)." });
            foreach (var (text, field) in new[]
            {
                (input.HouseholdSummary, "householdSummary"),
                (input.HouseholdDetail, "householdDetail"),
                (input.SkillSummary, "skillSummary"),
                (input.SkillDetail, "skillDetail"),
                (input.TasteCuisines, "tasteCuisines"),
                (input.AvoidDietary, "avoidDietary"),
                (input.EquipmentNote, "equipmentNote"),
            })
            {
                if (text?.Length > 2000)
                    return Results.BadRequest(new { error = $"{field}: maks. 2000 znaków." });
            }
            if (equipment.Any(e => (e.Name?.Trim().Length ?? 0) > 120))
                return Results.BadRequest(new { error = "Nazwa sprzętu może mieć maks. 120 znaków." });

            var prefs = await LoadOrCreate(db);
            prefs.HouseholdSummary = input.HouseholdSummary?.Trim() ?? "";
            prefs.HouseholdDetail = input.HouseholdDetail?.Trim() ?? "";
            prefs.SkillSummary = input.SkillSummary?.Trim() ?? "";
            prefs.SkillDetail = input.SkillDetail?.Trim() ?? "";
            prefs.TasteCuisines = input.TasteCuisines?.Trim() ?? "";
            prefs.AvoidDietary = input.AvoidDietary?.Trim() ?? "";
            prefs.EquipmentNote = input.EquipmentNote?.Trim() ?? "";
            prefs.UpdatedAt = DateTimeOffset.UtcNow;

            db.EquipmentItems.RemoveRange(prefs.Equipment);
            prefs.Equipment.Clear();
            var order = 0;
            foreach (var e in equipment)
            {
                if (string.IsNullOrWhiteSpace(e.Name)) continue;
                // Track new client-Guid children as Added explicitly so EF issues INSERT, not UPDATE.
                var item = new EquipmentItem
                {
                    PreferencesId = prefs.Id,
                    Name = e.Name.Trim(),
                    Favorite = e.Favorite,
                    Order = order++,
                };
                db.EquipmentItems.Add(item);
                prefs.Equipment.Add(item);
            }

            await db.SaveChangesAsync();
            export.Schedule();
            return Results.Ok(ToDto(prefs));
        });

        return api;
    }

    private static readonly PreferencesDto EmptyDto = new("", "", "", "", "", "", "", new());

    private static async Task<Preferences> LoadOrCreate(MiseDbContext db)
    {
        var prefs = await db.Preferences.Include(p => p.Equipment).OrderBy(p => p.Id).FirstOrDefaultAsync();
        if (prefs is null)
        {
            prefs = new Preferences();
            db.Preferences.Add(prefs);
            await db.SaveChangesAsync();
        }
        return prefs;
    }

    private static PreferencesDto ToDto(Preferences p) => new(
        p.HouseholdSummary, p.HouseholdDetail, p.SkillSummary, p.SkillDetail,
        p.TasteCuisines, p.AvoidDietary, p.EquipmentNote,
        p.Equipment.OrderBy(e => e.Order).Select(e => new EquipmentDto(e.Name, e.Favorite)).ToList());
}
