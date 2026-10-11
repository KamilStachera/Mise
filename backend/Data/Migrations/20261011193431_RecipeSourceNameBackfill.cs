using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Mise.Api.Data.Migrations
{
    /// <summary>
    /// Data-only: fills <c>Recipes.SourceName</c> for the imported collections, whose origin
    /// was so far only in the title ("Daily Dieta - …") or the blurb. Only touches rows
    /// without a source, so re-labelled recipes are left alone.
    /// </summary>
    public partial class RecipeSourceNameBackfill : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // The origin moves out of the title — the card eyebrow shows it instead.
            migrationBuilder.Sql("""
                UPDATE "Recipes"
                SET "SourceName" = 'Daily Dieta', "Title" = substr("Title", length('Daily Dieta - ') + 1)
                WHERE "SourceName" IS NULL AND "Title" LIKE 'Daily Dieta - %';
                """);

            (string Name, string BlurbPattern)[] byBlurb =
            [
                ("Blond Kuchara", "%Blond Kuchara%"),
                ("Jadłospis 2200 kcal", "%indywidualnego jadłospisu 2200 kcal%"),
                ("Jadłospis 1900 kcal", "%indywidualnego jadłospisu 1900 kcal%"),
                ("Bez jojo · Sara Moritz", "%„Bez jojo”%"),
            ];
            foreach (var (name, pattern) in byBlurb)
                migrationBuilder.Sql($"""
                    UPDATE "Recipes" SET "SourceName" = '{name}'
                    WHERE "SourceName" IS NULL AND "Blurb" LIKE '{pattern}';
                    """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Not reversed: the labels are plain data and can be edited per recipe.
        }
    }
}
