using Mise.Api.Services;

namespace Mise.Api.Features;

/// <summary>
/// The meals of the acting person's day (<see cref="Domain.MealSlot"/>): what the plan and the
/// diary are split into. Readable like the plan (anonymous = the public household's first
/// person, so the public week can name its rows); writes need edit rights.
/// </summary>
public static class MealEndpoints
{
    public static RouteGroupBuilder MapMeals(this RouteGroupBuilder api)
    {
        var g = api.MapGroup("/meals").WithTags("Meals");

        // Active meals in day order, then removed ones (Active=false) so old entries keep a name.
        g.MapGet("/", async (MealSlots meals, PersonScope person, CancellationToken ct) =>
            Results.Ok((await meals.ListAsync(person.Id, ct)).Select(Mapping.ToDto).ToList()));

        g.MapPut("/", async (MealSlotsInput input, MealSlots meals, PersonScope person, ContextExportService export,
            CancellationToken ct) =>
        {
            try
            {
                var list = await meals.ReplaceAsync(person.Id, input.Meals ?? [], ct);
                export.Schedule();   // plan.md names the rows
                return Results.Ok(list.Select(Mapping.ToDto).ToList());
            }
            catch (DiaryException ex) { return PlanEndpoints.Error(ex); }
        });

        return api;
    }
}
