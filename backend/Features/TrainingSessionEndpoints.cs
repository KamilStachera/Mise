using Microsoft.AspNetCore.Mvc;
using Mise.Api.Data;
using Mise.Api.Services;
using Mise.Api.Services.Training;

namespace Mise.Api.Features;

/// <summary>
/// Live workout tracker endpoints under <c>/api/training</c>: sessions, set-by-set logging,
/// finish with PR detection &amp; auto-deduped Activity linking, and personal records leaderboard.
/// Strictly private and scoped to <see cref="PersonScope"/>.
/// </summary>
public static class TrainingSessionEndpoints
{
    public static void MapTrainingSessions(this RouteGroupBuilder g)
    {
        g.MapGet("/sessions", async (int? limit, MiseDbContext db, PersonScope person,
            [FromServices] TrainingSessionService? svc, CancellationToken ct) =>
        {
            var service = svc ?? new TrainingSessionService(db, person);
            return Results.Ok(await service.ListSessionsAsync(limit ?? 30, ct));
        });

        g.MapGet("/sessions/{id:guid}", async (Guid id, MiseDbContext db, PersonScope person,
            [FromServices] TrainingSessionService? svc, CancellationToken ct) =>
        {
            var service = svc ?? new TrainingSessionService(db, person);
            return await service.GetDetailAsync(id, ct) is { } detail
                ? Results.Ok(detail)
                : Results.NotFound();
        });

        g.MapPost("/sessions", async (StartSessionInput input, MiseDbContext db, PersonScope person,
            [FromServices] TrainingSessionService? svc, CancellationToken ct) =>
        {
            var service = svc ?? new TrainingSessionService(db, person);
            var r = await service.StartAsync(input, ct);
            if (!r.Ok)
            {
                if (r.StatusCode == 409)
                    return Results.Conflict(new { error = r.Error, activeSessionId = r.ActiveSessionId });
                return r.StatusCode == 404
                    ? Results.NotFound(new { error = r.Error })
                    : Results.BadRequest(new { error = r.Error });
            }
            return Results.Created($"/api/training/sessions/{r.Value!.Id}", r.Value);
        });

        g.MapPatch("/sessions/{id:guid}", async (Guid id, PatchSessionInput input, MiseDbContext db,
            PersonScope person, [FromServices] TrainingSessionService? svc, CancellationToken ct) =>
        {
            var service = svc ?? new TrainingSessionService(db, person);
            var r = await service.PatchSessionAsync(id, input, ct);
            return ToResult(r);
        });

        g.MapPatch("/sessions/{id:guid}/sets/{setId:guid}", async (Guid id, Guid setId, PatchSessionSetInput input,
            MiseDbContext db, PersonScope person, [FromServices] TrainingSessionService? svc, CancellationToken ct) =>
        {
            var service = svc ?? new TrainingSessionService(db, person);
            var r = await service.PatchSetAsync(id, setId, input, ct);
            return ToResult(r);
        });

        g.MapPost("/sessions/{id:guid}/sets", async (Guid id, AddSessionSetInput input, MiseDbContext db,
            PersonScope person, [FromServices] TrainingSessionService? svc, CancellationToken ct) =>
        {
            var service = svc ?? new TrainingSessionService(db, person);
            var r = await service.AddSetAsync(id, input, ct);
            return r.Ok ? Results.Created($"/api/training/sessions/{id}", r.Value) : ToResult(r);
        });

        g.MapDelete("/sessions/{id:guid}/sets/{setId:guid}", async (Guid id, Guid setId, MiseDbContext db,
            PersonScope person, [FromServices] TrainingSessionService? svc, CancellationToken ct) =>
        {
            var service = svc ?? new TrainingSessionService(db, person);
            var r = await service.DeleteSetAsync(id, setId, ct);
            return ToResult(r);
        });

        g.MapPost("/sessions/{id:guid}/finish", async (Guid id, FinishSessionInput? input, MiseDbContext db,
            PersonScope person, [FromServices] TrainingSessionService? svc, CancellationToken ct) =>
        {
            var service = svc ?? new TrainingSessionService(db, person);
            var r = await service.FinishAsync(id, input ?? new(null, null, null, null, null, null), ct);
            return ToResult(r);
        });

        g.MapDelete("/sessions/{id:guid}", async (Guid id, MiseDbContext db, PersonScope person,
            [FromServices] TrainingSessionService? svc, CancellationToken ct) =>
        {
            var service = svc ?? new TrainingSessionService(db, person);
            return await service.DeleteAsync(id, ct) ? Results.NoContent() : Results.NotFound();
        });

        g.MapGet("/prs", async (MiseDbContext db, PersonScope person,
            [FromServices] TrainingSessionService? svc, CancellationToken ct) =>
        {
            var service = svc ?? new TrainingSessionService(db, person);
            return Results.Ok(await service.ListPrsAsync(ct));
        });
    }

    private static IResult ToResult<T>(TrainingSessionService.ServiceResult<T> r) => r.StatusCode switch
    {
        >= 200 and < 300 => Results.Ok(r.Value),
        404 => Results.NotFound(new { error = r.Error }),
        409 => Results.Conflict(new { error = r.Error, activeSessionId = r.ActiveSessionId }),
        _ => Results.BadRequest(new { error = r.Error }),
    };
}
