using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Mise.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class CustomMealSlots : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<string>(
                name: "Slot",
                table: "PlanEntries",
                type: "character varying(40)",
                maxLength: 40,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(16)",
                oldMaxLength: 16);

            // The enum was stored by name ("Breakfast"); slots are now lowercase meal keys, and the
            // four old values are exactly the default keys (MealSlots.Defaults), so nobody needs rows.
            migrationBuilder.Sql("UPDATE \"PlanEntries\" SET \"Slot\" = lower(\"Slot\");");

            migrationBuilder.CreateTable(
                name: "MealSlots",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    HouseholdId = table.Column<int>(type: "integer", nullable: false),
                    PersonId = table.Column<int>(type: "integer", nullable: false),
                    Key = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    Name = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    Position = table.Column<int>(type: "integer", nullable: false),
                    IsSnack = table.Column<bool>(type: "boolean", nullable: false),
                    ArchivedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_MealSlots", x => x.Id);
                    table.ForeignKey(
                        name: "FK_MealSlots_Households_HouseholdId",
                        column: x => x.HouseholdId,
                        principalTable: "Households",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_MealSlots_People_PersonId",
                        column: x => x.PersonId,
                        principalTable: "People",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_MealSlots_HouseholdId",
                table: "MealSlots",
                column: "HouseholdId");

            migrationBuilder.CreateIndex(
                name: "IX_MealSlots_PersonId_Key",
                table: "MealSlots",
                columns: new[] { "PersonId", "Key" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "MealSlots");

            // Custom meals have no enum value: they fall back to Lunch, as the old lenient parse did.
            migrationBuilder.Sql("""
                UPDATE "PlanEntries" SET "Slot" = CASE "Slot"
                    WHEN 'breakfast' THEN 'Breakfast' WHEN 'dinner' THEN 'Dinner' WHEN 'snack' THEN 'Snack'
                    ELSE 'Lunch' END;
                """);

            migrationBuilder.AlterColumn<string>(
                name: "Slot",
                table: "PlanEntries",
                type: "character varying(16)",
                maxLength: 16,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(40)",
                oldMaxLength: 40);
        }
    }
}
