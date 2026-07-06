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
            var prefs = await LoadOrCreate(db);
            return Results.Ok(ToDto(prefs));
        });

        g.MapPut("/", async (PreferencesDto input, MiseDbContext db, ContextExportService export) =>
        {
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
            foreach (var e in input.Equipment ?? new())
            {
                if (string.IsNullOrWhiteSpace(e.Name)) continue;
                prefs.Equipment.Add(new EquipmentItem { Name = e.Name.Trim(), Favorite = e.Favorite, Order = order++ });
            }

            await db.SaveChangesAsync();
            await export.ExportAsync();
            return Results.Ok(ToDto(prefs));
        });

        return api;
    }

    private static async Task<Preferences> LoadOrCreate(MiseDbContext db)
    {
        var prefs = await db.Preferences.Include(p => p.Equipment).OrderBy(p => p.Id).FirstOrDefaultAsync();
        if (prefs is null)
        {
            prefs = new Preferences { Id = 1 };
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
