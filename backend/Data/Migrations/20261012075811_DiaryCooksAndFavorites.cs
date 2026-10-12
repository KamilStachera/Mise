using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Mise.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class DiaryCooksAndFavorites : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_PlanEntries_Date_Slot",
                table: "PlanEntries");

            migrationBuilder.AddColumn<decimal>(
                name: "Carbs",
                table: "PlanEntries",
                type: "numeric(7,1)",
                precision: 7,
                scale: 1,
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "CookId",
                table: "PlanEntries",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "CreatedAt",
                table: "PlanEntries",
                type: "timestamp with time zone",
                nullable: false,
                defaultValue: new DateTimeOffset(new DateTime(1, 1, 1, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)));

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "EatenAt",
                table: "PlanEntries",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "Fat",
                table: "PlanEntries",
                type: "numeric(7,1)",
                precision: 7,
                scale: 1,
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "Grams",
                table: "PlanEntries",
                type: "numeric(8,1)",
                precision: 8,
                scale: 1,
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "IsLeftover",
                table: "PlanEntries",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<int>(
                name: "Kcal",
                table: "PlanEntries",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "Portions",
                table: "PlanEntries",
                type: "numeric(6,2)",
                precision: 6,
                scale: 2,
                nullable: false,
                // Every existing plan entry stood for one portion.
                defaultValue: 1m);

            migrationBuilder.AddColumn<decimal>(
                name: "Protein",
                table: "PlanEntries",
                type: "numeric(7,1)",
                precision: 7,
                scale: 1,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "Cooks",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    RecipeId = table.Column<Guid>(type: "uuid", nullable: true),
                    Title = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    Date = table.Column<DateOnly>(type: "date", nullable: false),
                    Portions = table.Column<int>(type: "integer", nullable: false),
                    DiscardedPortions = table.Column<int>(type: "integer", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Cooks", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Cooks_Recipes_RecipeId",
                        column: x => x.RecipeId,
                        principalTable: "Recipes",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "FoodFavorites",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    NormalizedName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Kcal = table.Column<int>(type: "integer", nullable: false),
                    Protein = table.Column<decimal>(type: "numeric(7,1)", precision: 7, scale: 1, nullable: true),
                    Fat = table.Column<decimal>(type: "numeric(7,1)", precision: 7, scale: 1, nullable: true),
                    Carbs = table.Column<decimal>(type: "numeric(7,1)", precision: 7, scale: 1, nullable: true),
                    Per100g = table.Column<bool>(type: "boolean", nullable: false),
                    LastGrams = table.Column<decimal>(type: "numeric(8,1)", precision: 8, scale: 1, nullable: true),
                    Barcode = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true),
                    AddCount = table.Column<int>(type: "integer", nullable: false),
                    LastAddedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    Pinned = table.Column<bool>(type: "boolean", nullable: false),
                    Hidden = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_FoodFavorites", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_PlanEntries_CookId",
                table: "PlanEntries",
                column: "CookId");

            migrationBuilder.CreateIndex(
                name: "IX_PlanEntries_Date_Slot",
                table: "PlanEntries",
                columns: new[] { "Date", "Slot" });

            migrationBuilder.CreateIndex(
                name: "IX_Cooks_Date",
                table: "Cooks",
                column: "Date");

            migrationBuilder.CreateIndex(
                name: "IX_Cooks_RecipeId",
                table: "Cooks",
                column: "RecipeId");

            migrationBuilder.CreateIndex(
                name: "IX_FoodFavorites_Barcode",
                table: "FoodFavorites",
                column: "Barcode");

            migrationBuilder.CreateIndex(
                name: "IX_FoodFavorites_NormalizedName",
                table: "FoodFavorites",
                column: "NormalizedName",
                unique: true);

            // Ordering inside a slot uses CreatedAt; the best history for old rows is their last edit.
            migrationBuilder.Sql("UPDATE \"PlanEntries\" SET \"CreatedAt\" = \"UpdatedAt\";");

            migrationBuilder.AddForeignKey(
                name: "FK_PlanEntries_Cooks_CookId",
                table: "PlanEntries",
                column: "CookId",
                principalTable: "Cooks",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_PlanEntries_Cooks_CookId",
                table: "PlanEntries");

            migrationBuilder.DropTable(
                name: "Cooks");

            migrationBuilder.DropTable(
                name: "FoodFavorites");

            migrationBuilder.DropIndex(
                name: "IX_PlanEntries_CookId",
                table: "PlanEntries");

            migrationBuilder.DropIndex(
                name: "IX_PlanEntries_Date_Slot",
                table: "PlanEntries");

            migrationBuilder.DropColumn(
                name: "Carbs",
                table: "PlanEntries");

            migrationBuilder.DropColumn(
                name: "CookId",
                table: "PlanEntries");

            migrationBuilder.DropColumn(
                name: "CreatedAt",
                table: "PlanEntries");

            migrationBuilder.DropColumn(
                name: "EatenAt",
                table: "PlanEntries");

            migrationBuilder.DropColumn(
                name: "Fat",
                table: "PlanEntries");

            migrationBuilder.DropColumn(
                name: "Grams",
                table: "PlanEntries");

            migrationBuilder.DropColumn(
                name: "IsLeftover",
                table: "PlanEntries");

            migrationBuilder.DropColumn(
                name: "Kcal",
                table: "PlanEntries");

            migrationBuilder.DropColumn(
                name: "Portions",
                table: "PlanEntries");

            migrationBuilder.DropColumn(
                name: "Protein",
                table: "PlanEntries");

            migrationBuilder.CreateIndex(
                name: "IX_PlanEntries_Date_Slot",
                table: "PlanEntries",
                columns: new[] { "Date", "Slot" },
                unique: true);
        }
    }
}
