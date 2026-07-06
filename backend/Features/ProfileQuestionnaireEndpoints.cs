using Microsoft.EntityFrameworkCore;
using Mise.Api.Data;
using Mise.Api.Domain;
using Mise.Api.Services;

namespace Mise.Api.Features;

public static class ProfileQuestionnaireEndpoints
{
    public static RouteGroupBuilder MapProfileQuestionnaire(this RouteGroupBuilder api)
    {
        var g = api.MapGroup("/profile").WithTags("Profile");

        g.MapGet("/questionnaire", async (MiseDbContext db) =>
        {
            var sections = ProfileQuestionnaire.Sections
                .Select(s => new QuestionnaireSectionDto(s.Key, s.Title,
                    s.Questions.Select(q => new QuestionDto(q.Key, q.Label, q.Type, q.Options, q.Placeholder)).ToList()))
                .ToList();
            var answers = await LoadAnswersAsync(db);
            return Results.Ok(new QuestionnaireDto(sections, answers));
        });

        // Upsert the provided keys; an empty value clears that answer.
        g.MapPut("/answers", async (AnswersInput input, MiseDbContext db, ContextExportService export) =>
        {
            var incoming = input.Answers ?? new();
            var unknown = incoming.Keys.Where(k => !ProfileQuestionnaire.ValidKeys.Contains(k)).ToList();
            if (unknown.Count > 0)
                return Results.BadRequest(new { error = $"Nieznane pytania: {string.Join(", ", unknown)}" });

            var rows = await db.ProfileAnswers.ToListAsync();
            foreach (var (key, rawValue) in incoming)
            {
                var value = rawValue?.Trim() ?? "";
                var row = rows.FirstOrDefault(r => r.Key == key);
                if (value.Length == 0)
                {
                    if (row is not null) db.ProfileAnswers.Remove(row);
                }
                else if (row is null)
                {
                    db.ProfileAnswers.Add(new ProfileAnswer { Key = key, Value = value });
                }
                else if (row.Value != value)
                {
                    row.Value = value;
                    row.UpdatedAt = DateTimeOffset.UtcNow;
                }
            }
            await db.SaveChangesAsync();
            await export.ExportAsync();
            return Results.Ok(new { answers = await LoadAnswersAsync(db) });
        });

        return api;
    }

    private static async Task<Dictionary<string, string>> LoadAnswersAsync(MiseDbContext db) =>
        await db.ProfileAnswers.AsNoTracking().ToDictionaryAsync(a => a.Key, a => a.Value);
}
