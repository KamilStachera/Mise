using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Mise.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class RecipeNutrition : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<decimal>(
                name: "CarbGrams",
                table: "Recipes",
                type: "numeric",
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "FatGrams",
                table: "Recipes",
                type: "numeric",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "KcalPerServing",
                table: "Recipes",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "ProteinGrams",
                table: "Recipes",
                type: "numeric",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "CarbGrams",
                table: "Recipes");

            migrationBuilder.DropColumn(
                name: "FatGrams",
                table: "Recipes");

            migrationBuilder.DropColumn(
                name: "KcalPerServing",
                table: "Recipes");

            migrationBuilder.DropColumn(
                name: "ProteinGrams",
                table: "Recipes");
        }
    }
}
