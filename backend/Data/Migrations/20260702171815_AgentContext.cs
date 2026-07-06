using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Mise.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AgentContext : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "CookLog",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    RecipeId = table.Column<Guid>(type: "uuid", nullable: true),
                    DishName = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    Rating = table.Column<int>(type: "integer", nullable: true),
                    Note = table.Column<string>(type: "text", nullable: false),
                    CookedAt = table.Column<DateOnly>(type: "date", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CookLog", x => x.Id);
                    table.ForeignKey(
                        name: "FK_CookLog_Recipes_RecipeId",
                        column: x => x.RecipeId,
                        principalTable: "Recipes",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "PlanEntries",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Date = table.Column<DateOnly>(type: "date", nullable: false),
                    Slot = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    RecipeId = table.Column<Guid>(type: "uuid", nullable: true),
                    Title = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    Note = table.Column<string>(type: "text", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PlanEntries", x => x.Id);
                    table.ForeignKey(
                        name: "FK_PlanEntries_Recipes_RecipeId",
                        column: x => x.RecipeId,
                        principalTable: "Recipes",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "ProfileAnswers",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Key = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    Value = table.Column<string>(type: "text", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ProfileAnswers", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_CookLog_CookedAt",
                table: "CookLog",
                column: "CookedAt");

            migrationBuilder.CreateIndex(
                name: "IX_CookLog_RecipeId",
                table: "CookLog",
                column: "RecipeId");

            migrationBuilder.CreateIndex(
                name: "IX_PlanEntries_Date_Slot",
                table: "PlanEntries",
                columns: new[] { "Date", "Slot" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_PlanEntries_RecipeId",
                table: "PlanEntries",
                column: "RecipeId");

            migrationBuilder.CreateIndex(
                name: "IX_ProfileAnswers_Key",
                table: "ProfileAnswers",
                column: "Key",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "CookLog");

            migrationBuilder.DropTable(
                name: "PlanEntries");

            migrationBuilder.DropTable(
                name: "ProfileAnswers");
        }
    }
}
