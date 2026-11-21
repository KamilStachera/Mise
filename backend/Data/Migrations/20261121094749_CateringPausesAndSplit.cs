using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Mise.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class CateringPausesAndSplit : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_PlanEntries_PersonId_Date_Catering",
                table: "PlanEntries");

            migrationBuilder.AddColumn<bool>(
                name: "SplitMeals",
                table: "Caterings",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.CreateTable(
                name: "CateringPauses",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    HouseholdId = table.Column<int>(type: "integer", nullable: false),
                    PersonId = table.Column<int>(type: "integer", nullable: false),
                    From = table.Column<DateOnly>(type: "date", nullable: false),
                    To = table.Column<DateOnly>(type: "date", nullable: false),
                    Note = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CateringPauses", x => x.Id);
                    table.ForeignKey(
                        name: "FK_CateringPauses_Households_HouseholdId",
                        column: x => x.HouseholdId,
                        principalTable: "Households",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_CateringPauses_People_PersonId",
                        column: x => x.PersonId,
                        principalTable: "People",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_PlanEntries_PersonId_Date_Slot_Catering",
                table: "PlanEntries",
                columns: new[] { "PersonId", "Date", "Slot" },
                unique: true,
                filter: "\"IsCatering\"");

            migrationBuilder.CreateIndex(
                name: "IX_CateringPauses_HouseholdId",
                table: "CateringPauses",
                column: "HouseholdId");

            migrationBuilder.CreateIndex(
                name: "IX_CateringPauses_PersonId_From_To",
                table: "CateringPauses",
                columns: new[] { "PersonId", "From", "To" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "CateringPauses");

            migrationBuilder.DropIndex(
                name: "IX_PlanEntries_PersonId_Date_Slot_Catering",
                table: "PlanEntries");

            migrationBuilder.DropColumn(
                name: "SplitMeals",
                table: "Caterings");

            migrationBuilder.CreateIndex(
                name: "IX_PlanEntries_PersonId_Date_Catering",
                table: "PlanEntries",
                columns: new[] { "PersonId", "Date" },
                unique: true,
                filter: "\"IsCatering\"");
        }
    }
}
