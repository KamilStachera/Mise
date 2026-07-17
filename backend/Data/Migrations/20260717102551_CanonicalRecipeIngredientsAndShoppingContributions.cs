using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Mise.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class CanonicalRecipeIngredientsAndShoppingContributions : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "DisplayText",
                table: "RecipeIngredients",
                type: "character varying(500)",
                maxLength: 500,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "ShoppingContributions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ShoppingItemId = table.Column<Guid>(type: "uuid", nullable: false),
                    SourceKey = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    SourceLabel = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    RequiredQuantity = table.Column<decimal>(type: "numeric(10,2)", precision: 10, scale: 2, nullable: true),
                    Unit = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ShoppingContributions", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ShoppingContributions_ShoppingItems_ShoppingItemId",
                        column: x => x.ShoppingItemId,
                        principalTable: "ShoppingItems",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ShoppingContributions_ShoppingItemId_SourceKey",
                table: "ShoppingContributions",
                columns: new[] { "ShoppingItemId", "SourceKey" });

            migrationBuilder.CreateIndex(
                name: "IX_ShoppingContributions_SourceKey",
                table: "ShoppingContributions",
                column: "SourceKey");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ShoppingContributions");

            migrationBuilder.DropColumn(
                name: "DisplayText",
                table: "RecipeIngredients");
        }
    }
}
