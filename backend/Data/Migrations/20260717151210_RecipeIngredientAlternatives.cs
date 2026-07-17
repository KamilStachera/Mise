using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Mise.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class RecipeIngredientAlternatives : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "AlternativeKey",
                table: "ShoppingItems",
                type: "character varying(1000)",
                maxLength: 1000,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "AlternativePantryItemIds",
                table: "ShoppingItems",
                type: "character varying(1000)",
                maxLength: 1000,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "AlternativeGroup",
                table: "RecipeIngredients",
                type: "character varying(100)",
                maxLength: 100,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "AlternativeKey",
                table: "ShoppingItems");

            migrationBuilder.DropColumn(
                name: "AlternativePantryItemIds",
                table: "ShoppingItems");

            migrationBuilder.DropColumn(
                name: "AlternativeGroup",
                table: "RecipeIngredients");
        }
    }
}
