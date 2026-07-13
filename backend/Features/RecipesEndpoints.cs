using Microsoft.EntityFrameworkCore;
using Mise.Api.Data;
using Mise.Api.Domain;
using Mise.Api.Services;

namespace Mise.Api.Features;

public static class RecipesEndpoints
{
    public static RouteGroupBuilder MapRecipes(this RouteGroupBuilder api)
    {
        var g = api.MapGroup("/recipes").WithTags("Recipes");

        g.MapGet("/", async (string? source, string? q, string? dishType, string? cuisine,
            int? maxTime, bool? airFryer, MiseDbContext db) =>
        {
            if (!Mapping.TryParseDishType(dishType, out var dt))
                return BadDishType();
            if (!Mapping.TryParseCuisine(cuisine, out var cu))
                return BadCuisine();

            var pantryById = await db.PantryItems.AsNoTracking()
                .ToDictionaryAsync(p => p.Id);

            // Steps feed the air-fryer fallback heuristic (AirFryer.Uses).
            var query = db.Recipes.AsNoTracking()
                .Include(r => r.Ingredients)
                .Include(r => r.Steps)
                .AsSplitQuery()
                .AsQueryable();
            if (!string.IsNullOrWhiteSpace(source) && source != "all")
                query = query.Where(r => r.Source == Mapping.ParseSource(source));
            if (!string.IsNullOrWhiteSpace(q))
            {
                var term = q.Trim().ToLower();
                query = query.Where(r => r.Title.ToLower().Contains(term));
            }
            if (dt is DishType wantedDish)
                query = query.Where(r => r.DishType == wantedDish);
            if (cu is Cuisine wantedCuisine)
                query = query.Where(r => r.Cuisine == wantedCuisine);
            if (maxTime is > 0)
                query = query.Where(r => r.TimeMinutes <= maxTime);

            var recipes = await query.ToListAsync();
            // Resolved flag (stored value or heuristic), so this filter runs in memory.
            if (airFryer is bool wantAirFryer)
                recipes = recipes.Where(r => AirFryer.Uses(r) == wantAirFryer).ToList();
            var list = recipes.OrderBy(r => r.Title, Pl.Comparer).Select(r =>
            {
                var toBuy = r.Ingredients.Count(i =>
                    Mapping.IsToBuy(Mapping.IngredientAvailability(i, pantryById).Status));
                return new RecipeListItemDto(r.Id, r.Title, Mapping.SourceString(r.Source),
                    r.TimeMinutes, r.Servings, r.Difficulty, r.Tint, r.Blurb,
                    Mapping.ImageUrl(r.ImagePath), toBuy,
                    Mapping.DishTypeString(r.DishType), Mapping.CuisineString(r.Cuisine),
                    AirFryer.Uses(r), r.CreatedAt,
                    r.KcalPerServing, r.ProteinGrams, r.FatGrams, r.CarbGrams);
            });
            return Results.Ok(list);
        });

        g.MapGet("/{id:guid}", async (Guid id, MiseDbContext db) =>
        {
            var r = await db.Recipes.AsNoTracking()
                .Include(x => x.Ingredients)
                .Include(x => x.Steps)
                .Include(x => x.Images)
                .AsSplitQuery()
                .FirstOrDefaultAsync(x => x.Id == id);
            if (r is null) return Results.NotFound();

            var pantryById = await db.PantryItems.AsNoTracking()
                .ToDictionaryAsync(p => p.Id);

            var ingredients = r.Ingredients.OrderBy(i => i.Order)
                .Select(i => new IngredientDto(i.Name, i.Quantity,
                    Mapping.IngredientAvailability(i, pantryById).Status))
                .ToList();
            var missing = ingredients.Where(i => Mapping.IsToBuy(i.Status)).Select(i => i.Name).ToList();
            var steps = r.Steps.OrderBy(s => s.Order).Select(s => s.Text).ToList();

            return Results.Ok(new RecipeDetailDto(r.Id, r.Title, Mapping.SourceString(r.Source),
                r.TimeMinutes, r.Servings, r.Difficulty, r.Tint, r.Blurb,
                Mapping.ImageUrl(r.ImagePath), r.Tip,
                ingredients, steps, ingredients.Count - missing.Count, ingredients.Count, missing,
                Mapping.DishTypeString(r.DishType), Mapping.CuisineString(r.Cuisine),
                AirFryer.Uses(r), GalleryDto(r),
                r.KcalPerServing, r.ProteinGrams, r.FatGrams, r.CarbGrams));
        });

        g.MapPost("/", async (RecipeInput input, MiseDbContext db, IngredientMatcher matcher,
            ContextExportService export) =>
        {
            if (!Mapping.TryParseDishType(input.DishType, out var dt))
                return BadDishType();
            if (!Mapping.TryParseCuisine(input.Cuisine, out var cu))
                return BadCuisine();
            if (BadIngredientUnit(input) is IResult badUnit)
                return badUnit;

            var pantry = await db.PantryItems.AsNoTracking().ToListAsync();
            var recipe = ApplyInput(new Recipe(), input, dt, cu, pantry, matcher);
            db.Recipes.Add(recipe);
            await db.SaveChangesAsync();
            await export.ExportAsync();
            return Results.Created($"/api/recipes/{recipe.Id}", new { recipe.Id });
        });

        g.MapPut("/{id:guid}", async (Guid id, RecipeInput input, MiseDbContext db,
            IngredientMatcher matcher, ContextExportService export) =>
        {
            if (!Mapping.TryParseDishType(input.DishType, out var dt))
                return BadDishType();
            if (!Mapping.TryParseCuisine(input.Cuisine, out var cu))
                return BadCuisine();
            if (BadIngredientUnit(input) is IResult badUnit)
                return badUnit;

            var recipe = await db.Recipes
                .Include(r => r.Ingredients)
                .Include(r => r.Steps)
                .AsSplitQuery()
                .FirstOrDefaultAsync(r => r.Id == id);
            if (recipe is null) return Results.NotFound();

            db.RecipeIngredients.RemoveRange(recipe.Ingredients);
            db.RecipeSteps.RemoveRange(recipe.Steps);
            recipe.Ingredients.Clear();
            recipe.Steps.Clear();

            var pantry = await db.PantryItems.AsNoTracking().ToListAsync();
            ApplyInput(recipe, input, dt, cu, pantry, matcher);
            // Children self-assign Guid ids, so change detection would treat them as
            // existing rows (UPDATE → 0 rows → concurrency error); register as inserts.
            db.RecipeIngredients.AddRange(recipe.Ingredients);
            db.RecipeSteps.AddRange(recipe.Steps);
            recipe.UpdatedAt = DateTimeOffset.UtcNow;
            await db.SaveChangesAsync();
            await export.ExportAsync();
            return Results.NoContent();
        });

        g.MapDelete("/{id:guid}", async (Guid id, MiseDbContext db, RecipeImageStore images,
            ContextExportService export) =>
        {
            var recipe = await db.Recipes.Include(r => r.Images)
                .FirstOrDefaultAsync(r => r.Id == id);
            if (recipe is null) return Results.NotFound();
            db.Recipes.Remove(recipe);
            await db.SaveChangesAsync();
            foreach (var img in recipe.Images) images.Delete(img.Path);
            await export.ExportAsync();
            return Results.NoContent();
        });

        // Upload a photo: it joins the gallery and becomes the new default.
        g.MapPost("/{id:guid}/image", async (Guid id, IFormFile file, MiseDbContext db,
            RecipeImageStore images) =>
        {
            var recipe = await db.Recipes.Include(r => r.Images)
                .FirstOrDefaultAsync(r => r.Id == id);
            if (recipe is null) return Results.NotFound();
            if (!RecipeImageStore.TryGetExtension(file.ContentType, out _))
                return Results.BadRequest(new
                {
                    error = "Nieobsługiwany typ pliku.",
                    allowed = RecipeImageStore.AllowedContentTypes,
                });
            if (file.Length is 0 or > RecipeImageStore.MaxBytes)
                return Results.BadRequest(new { error = "Plik musi mieć od 1 B do 5 MB." });

            var image = new RecipeImage { RecipeId = id, Path = await images.SaveAsync(id, file) };
            recipe.Images.Add(image);
            // Self-assigned Guid id — register as an insert (see the PUT handler above).
            db.RecipeImages.Add(image);
            recipe.ImagePath = image.Path;
            recipe.UpdatedAt = DateTimeOffset.UtcNow;
            await db.SaveChangesAsync();
            return Results.Ok(new
            {
                imageId = image.Id,
                imageUrl = Mapping.ImageUrl(image.Path),
                images = GalleryDto(recipe),
            });
        }).DisableAntiforgery();

        g.MapGet("/{id:guid}/images", async (Guid id, MiseDbContext db) =>
        {
            var recipe = await db.Recipes.AsNoTracking().Include(r => r.Images)
                .FirstOrDefaultAsync(r => r.Id == id);
            return recipe is null ? Results.NotFound() : Results.Ok(GalleryDto(recipe));
        });

        // Promote an older gallery photo back to default.
        g.MapPut("/{id:guid}/images/{imageId:guid}/default", async (Guid id, Guid imageId,
            MiseDbContext db) =>
        {
            var recipe = await db.Recipes.Include(r => r.Images)
                .FirstOrDefaultAsync(r => r.Id == id);
            var image = recipe?.Images.FirstOrDefault(i => i.Id == imageId);
            if (recipe is null || image is null) return Results.NotFound();
            recipe.ImagePath = image.Path;
            recipe.UpdatedAt = DateTimeOffset.UtcNow;
            await db.SaveChangesAsync();
            return Results.Ok(new { images = GalleryDto(recipe) });
        });

        // Remove one gallery photo; a deleted default falls back to the newest remaining.
        g.MapDelete("/{id:guid}/images/{imageId:guid}", async (Guid id, Guid imageId,
            MiseDbContext db, RecipeImageStore images) =>
        {
            var recipe = await db.Recipes.Include(r => r.Images)
                .FirstOrDefaultAsync(r => r.Id == id);
            var image = recipe?.Images.FirstOrDefault(i => i.Id == imageId);
            if (recipe is null || image is null) return Results.NotFound();
            recipe.Images.Remove(image);
            db.RecipeImages.Remove(image);
            if (recipe.ImagePath == image.Path)
                recipe.ImagePath = recipe.Images.OrderByDescending(i => i.CreatedAt)
                    .FirstOrDefault()?.Path;
            recipe.UpdatedAt = DateTimeOffset.UtcNow;
            await db.SaveChangesAsync();
            images.Delete(image.Path);
            return Results.Ok(new { images = GalleryDto(recipe) });
        });

        // Legacy: remove the current default photo (same fallback as above).
        g.MapDelete("/{id:guid}/image", async (Guid id, MiseDbContext db, RecipeImageStore images) =>
        {
            var recipe = await db.Recipes.Include(r => r.Images)
                .FirstOrDefaultAsync(r => r.Id == id);
            if (recipe is null) return Results.NotFound();
            var image = recipe.Images.FirstOrDefault(i => i.Path == recipe.ImagePath);
            if (image is not null)
            {
                recipe.Images.Remove(image);
                db.RecipeImages.Remove(image);
            }
            recipe.ImagePath = recipe.Images.OrderByDescending(i => i.CreatedAt)
                .FirstOrDefault()?.Path;
            recipe.UpdatedAt = DateTimeOffset.UtcNow;
            await db.SaveChangesAsync();
            if (image is not null) images.Delete(image.Path);
            return Results.NoContent();
        });

        // What "Ugotowane!" would subtract from the pantry — the UI shows this as an
        // editable confirm dialog before POSTing /cooklog with the chosen deductions.
        g.MapGet("/{id:guid}/cook-proposal", async (Guid id, MiseDbContext db) =>
        {
            var r = await db.Recipes.AsNoTracking()
                .Include(x => x.Ingredients)
                .FirstOrDefaultAsync(x => x.Id == id);
            if (r is null) return Results.NotFound();

            var pantryById = await db.PantryItems.AsNoTracking().ToDictionaryAsync(p => p.Id);

            var items = r.Ingredients.OrderBy(i => i.Order).Select(i =>
            {
                var pantryItem = i.PantryItemId is Guid pid ? pantryById.GetValueOrDefault(pid) : null;

                var amount = i.AmountValue;
                var unit = i.AmountUnit;
                if (amount is null && QuantityParser.TryParse(i.Quantity, out var v, out var u))
                    (amount, unit) = (v, u);

                var skip = pantryItem is null ? "unlinked"
                    : amount is null ? "unparsed"
                    : unit != pantryItem.Unit ? "unit-mismatch"
                    : null;

                return new CookProposalItemDto(
                    i.Id, i.Name, i.Quantity,
                    pantryItem?.Id, pantryItem?.Name,
                    pantryItem is not null ? Mapping.UnitString(pantryItem.Unit) : null,
                    pantryItem?.Quantity,
                    skip is null ? amount : null,
                    Deductible: skip is null,
                    SkipReason: skip);
            }).ToList();

            return Results.Ok(new CookProposalDto(r.Id, r.Title, items));
        });

        // Add the recipe's short / out-of-stock / unmatched ingredients to the shopping list.
        g.MapPost("/{id:guid}/add-missing-to-shopping", async (Guid id, MiseDbContext db,
            ShoppingService shopping, ContextExportService export) =>
        {
            var recipe = await db.Recipes.AsNoTracking()
                .Include(r => r.Ingredients)
                .FirstOrDefaultAsync(r => r.Id == id);
            if (recipe is null) return Results.NotFound();

            var added = await shopping.AddMissingForRecipesAsync(db, new[] { recipe });
            if (added > 0) await export.ExportAsync();
            return Results.Ok(new { added });
        });

        return api;
    }

    /// <summary>Gallery newest-first; the default photo is flagged, not reordered.</summary>
    private static List<RecipeImageDto> GalleryDto(Recipe r) => r.Images
        .OrderByDescending(i => i.CreatedAt)
        .Select(i => new RecipeImageDto(i.Id, Mapping.ImageUrl(i.Path)!, i.Path == r.ImagePath, i.CreatedAt))
        .ToList();

    private static IResult BadDishType() => Results.BadRequest(new
    {
        error = "Nieznany dishType.",
        allowed = Mapping.AllowedDishTypes,
    });

    private static IResult BadCuisine() => Results.BadRequest(new
    {
        error = "Nieznana cuisine.",
        allowed = Mapping.AllowedCuisines,
    });

    private static IResult? BadIngredientUnit(RecipeInput input)
    {
        foreach (var i in input.Ingredients ?? new())
            if (!Mapping.TryParseUnit(i.AmountUnit, out _))
                return Results.BadRequest(new
                {
                    error = $"Nieznana jednostka '{i.AmountUnit}' przy składniku '{i.Name}'.",
                    allowed = Mapping.AllowedUnits,
                });
        return null;
    }

    private static Recipe ApplyInput(Recipe recipe, RecipeInput input,
        DishType? dishType, Cuisine? cuisine,
        IReadOnlyList<PantryItem> pantry, IngredientMatcher matcher)
    {
        recipe.Title = input.Title.Trim();
        recipe.Source = Mapping.ParseSource(input.Source);
        recipe.DishType = dishType;
        recipe.Cuisine = cuisine;
        recipe.UsesAirFryer = input.UsesAirFryer;
        recipe.TimeMinutes = input.Time;
        recipe.Servings = input.Servings <= 0 ? 2 : input.Servings;
        recipe.Difficulty = string.IsNullOrWhiteSpace(input.Difficulty) ? "Łatwe" : input.Difficulty!.Trim();
        recipe.Tint = string.IsNullOrWhiteSpace(input.Tint) ? "#c0552d" : input.Tint!.Trim();
        recipe.Blurb = input.Blurb?.Trim() ?? "";
        recipe.Tip = string.IsNullOrWhiteSpace(input.Tip) ? null : input.Tip!.Trim();
        // Per-serving estimates; non-positive values mean "no estimate" (full-replace clears).
        recipe.KcalPerServing = input.Kcal is > 0 ? input.Kcal : null;
        recipe.ProteinGrams = input.Protein is > 0 ? input.Protein : null;
        recipe.FatGrams = input.Fat is > 0 ? input.Fat : null;
        recipe.CarbGrams = input.Carbs is > 0 ? input.Carbs : null;

        var order = 0;
        foreach (var i in input.Ingredients ?? new())
        {
            if (string.IsNullOrWhiteSpace(i.Name)) continue;
            var match = matcher.FindMatch(i.Name, pantry);
            var quantityText = i.Quantity?.Trim() ?? "";

            // Structured amount: explicit input wins (agents send it); otherwise a
            // best-effort parse of the display text covers UI-entered recipes.
            decimal? amountValue = null;
            PantryUnit? amountUnit = null;
            if (i.AmountValue is > 0 && Mapping.TryParseUnit(i.AmountUnit, out var explicitUnit)
                && explicitUnit is PantryUnit eu)
                (amountValue, amountUnit) = (i.AmountValue, eu);
            else if (QuantityParser.TryParse(quantityText, out var v, out var u))
                (amountValue, amountUnit) = (v, u);

            recipe.Ingredients.Add(new RecipeIngredient
            {
                Name = i.Name.Trim(),
                Quantity = quantityText,
                Order = order++,
                AmountValue = amountValue,
                AmountUnit = amountUnit,
                PantryItemId = match?.Id,
            });
        }

        order = 0;
        foreach (var s in input.Steps ?? new())
        {
            if (string.IsNullOrWhiteSpace(s)) continue;
            recipe.Steps.Add(new RecipeStep { Order = order++, Text = s.Trim() });
        }
        return recipe;
    }
}
