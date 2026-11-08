using Microsoft.EntityFrameworkCore;
using Mise.Api.Data;
using Mise.Api.Domain;
using Mise.Api.Services;

namespace Mise.Api.Features;

public record ApiKeyDto(Guid Id, string Name, string Prefix, DateTimeOffset CreatedAt, DateTimeOffset? LastUsedAt);
public record ApiKeyCreatedDto(Guid Id, string Name, string Prefix, string Key);
public record ApiKeyInput(string? Name);

/// <summary>
/// Personal API keys for agents/MCP (<c>MISE_API_KEY</c> in their config). A key acts as the
/// person who made it, in that person's household. The plain key is returned once.
/// </summary>
public static class KeyEndpoints
{
    public static RouteGroupBuilder MapKeys(this RouteGroupBuilder api)
    {
        var g = api.MapGroup("/keys").WithTags("Keys");

        g.MapGet("/", async (Caller caller, MiseDbContext db, CancellationToken ct) =>
            Results.Ok(await db.ApiKeys.AsNoTracking()
                .Where(k => k.PersonId == caller.Self!.Id && k.RevokedAt == null)
                .OrderBy(k => k.CreatedAt)
                .Select(k => new ApiKeyDto(k.Id, k.Name, k.Prefix, k.CreatedAt, k.LastUsedAt))
                .ToListAsync(ct)));

        g.MapPost("/", async (ApiKeyInput input, Caller caller, MiseDbContext db, CancellationToken ct) =>
        {
            var name = input.Name?.Trim();
            if (string.IsNullOrEmpty(name) || name.Length > 80) return Results.BadRequest(new { error = "Nazwa klucza: 1–80 znaków." });
            var key = AccessControl.NewPersonalKey();
            var row = new ApiKey
            {
                PersonId = caller.Self!.Id,
                Name = name,
                KeyHash = AccessControl.HashKey(key),
                Prefix = key[..10],
            };
            db.ApiKeys.Add(row);
            await db.SaveChangesAsync(ct);
            return Results.Ok(new ApiKeyCreatedDto(row.Id, row.Name, row.Prefix, key));
        });

        g.MapDelete("/{id:guid}", async (Guid id, Caller caller, MiseDbContext db, CancellationToken ct) =>
        {
            var key = await db.ApiKeys.FirstOrDefaultAsync(k => k.Id == id && k.PersonId == caller.Self!.Id && k.RevokedAt == null, ct);
            if (key is null) return Results.NotFound();
            key.RevokedAt = DateTimeOffset.UtcNow;
            await db.SaveChangesAsync(ct);
            return Results.NoContent();
        });

        return api;
    }
}
