using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Mise.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class QuantityPantry : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Fresh start (deliberate): real quantities can't be derived from the old
            // three-state status, so pantry and shopping rows are wiped. The catalog
            // reseeds at startup (SeedData) and recipe-ingredient links are restored
            // by DbInitializer's relink pass. Rows must go before Status→Unit renames.
            migrationBuilder.Sql("""DELETE FROM "ShoppingItems";""");
            migrationBuilder.Sql("""UPDATE "RecipeIngredients" SET "PantryItemId" = NULL;""");
            migrationBuilder.Sql("""DELETE FROM "PantryItems";""");

            migrationBuilder.RenameColumn(
                name: "Status",
                table: "PantryItems",
                newName: "Unit");

            migrationBuilder.AddColumn<decimal>(
                name: "Quantity",
                table: "ShoppingItems",
                type: "numeric(10,2)",
                precision: 10,
                scale: 2,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Unit",
                table: "ShoppingItems",
                type: "character varying(8)",
                maxLength: 8,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "AmountUnit",
                table: "RecipeIngredients",
                type: "character varying(8)",
                maxLength: 8,
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "AmountValue",
                table: "RecipeIngredients",
                type: "numeric(10,2)",
                precision: 10,
                scale: 2,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Aliases",
                table: "PantryItems",
                type: "character varying(500)",
                maxLength: 500,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<decimal>(
                name: "LowThreshold",
                table: "PantryItems",
                type: "numeric(10,2)",
                precision: 10,
                scale: 2,
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "Quantity",
                table: "PantryItems",
                type: "numeric(10,2)",
                precision: 10,
                scale: 2,
                nullable: false,
                defaultValue: 0m);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Quantity",
                table: "ShoppingItems");

            migrationBuilder.DropColumn(
                name: "Unit",
                table: "ShoppingItems");

            migrationBuilder.DropColumn(
                name: "AmountUnit",
                table: "RecipeIngredients");

            migrationBuilder.DropColumn(
                name: "AmountValue",
                table: "RecipeIngredients");

            migrationBuilder.DropColumn(
                name: "Aliases",
                table: "PantryItems");

            migrationBuilder.DropColumn(
                name: "LowThreshold",
                table: "PantryItems");

            migrationBuilder.DropColumn(
                name: "Quantity",
                table: "PantryItems");

            migrationBuilder.RenameColumn(
                name: "Unit",
                table: "PantryItems",
                newName: "Status");
        }
    }
}
