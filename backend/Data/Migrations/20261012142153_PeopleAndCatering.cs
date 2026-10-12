using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Mise.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class PeopleAndCatering : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Workouts_Date",
                table: "Workouts");

            migrationBuilder.DropIndex(
                name: "IX_Workouts_ExternalKey",
                table: "Workouts");

            migrationBuilder.DropIndex(
                name: "IX_WeightEntries_Date",
                table: "WeightEntries");

            migrationBuilder.DropIndex(
                name: "IX_FoodFavorites_NormalizedName",
                table: "FoodFavorites");

            migrationBuilder.DropIndex(
                name: "IX_EnergySamples_Date",
                table: "EnergySamples");

            migrationBuilder.DropIndex(
                name: "IX_EnergySamples_Kind_Start_End",
                table: "EnergySamples");

            migrationBuilder.RenameColumn(
                name: "Id",
                table: "HealthSyncs",
                newName: "PersonId");

            migrationBuilder.RenameColumn(
                name: "Id",
                table: "BodyProfiles",
                newName: "PersonId");

            migrationBuilder.AddColumn<int>(
                name: "PersonId",
                table: "Workouts",
                type: "integer",
                nullable: false,
                defaultValue: 1);

            migrationBuilder.AddColumn<int>(
                name: "PersonId",
                table: "WeightEntries",
                type: "integer",
                nullable: false,
                defaultValue: 1);

            migrationBuilder.AddColumn<bool>(
                name: "IsCatering",
                table: "PlanEntries",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<int>(
                name: "PersonId",
                table: "PlanEntries",
                type: "integer",
                nullable: false,
                defaultValue: 1);

            migrationBuilder.AddColumn<int>(
                name: "PersonId",
                table: "FoodFavorites",
                type: "integer",
                nullable: false,
                defaultValue: 1);

            migrationBuilder.AddColumn<int>(
                name: "PersonId",
                table: "EnergySamples",
                type: "integer",
                nullable: false,
                defaultValue: 1);

            migrationBuilder.AddColumn<int>(
                name: "PersonId",
                table: "Cooks",
                type: "integer",
                nullable: false,
                defaultValue: 1);

            migrationBuilder.CreateTable(
                name: "People",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false),
                    Name = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    Email = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_People", x => x.Id);
                });

            // Person 1 owns everything logged so far (backfilled via the column defaults above);
            // DbInitializer renames her from config on boot.
            migrationBuilder.InsertData(
                table: "People",
                columns: new[] { "Id", "Name", "Email" },
                values: new object[] { 1, "Ja", null });

            migrationBuilder.CreateTable(
                name: "Caterings",
                columns: table => new
                {
                    PersonId = table.Column<int>(type: "integer", nullable: false),
                    Enabled = table.Column<bool>(type: "boolean", nullable: false),
                    Kcal = table.Column<int>(type: "integer", nullable: false),
                    Protein = table.Column<decimal>(type: "numeric(7,1)", precision: 7, scale: 1, nullable: true),
                    Fat = table.Column<decimal>(type: "numeric(7,1)", precision: 7, scale: 1, nullable: true),
                    Carbs = table.Column<decimal>(type: "numeric(7,1)", precision: 7, scale: 1, nullable: true),
                    Weekdays = table.Column<int>(type: "integer", nullable: false),
                    StartDate = table.Column<DateOnly>(type: "date", nullable: false),
                    MaterializedThrough = table.Column<DateOnly>(type: "date", nullable: true),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Caterings", x => x.PersonId);
                    table.ForeignKey(
                        name: "FK_Caterings_People_PersonId",
                        column: x => x.PersonId,
                        principalTable: "People",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Workouts_PersonId_Date",
                table: "Workouts",
                columns: new[] { "PersonId", "Date" });

            migrationBuilder.CreateIndex(
                name: "IX_Workouts_PersonId_ExternalKey",
                table: "Workouts",
                columns: new[] { "PersonId", "ExternalKey" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_WeightEntries_PersonId_Date",
                table: "WeightEntries",
                columns: new[] { "PersonId", "Date" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_PlanEntries_PersonId_Date",
                table: "PlanEntries",
                columns: new[] { "PersonId", "Date" });

            migrationBuilder.CreateIndex(
                name: "IX_FoodFavorites_PersonId_NormalizedName",
                table: "FoodFavorites",
                columns: new[] { "PersonId", "NormalizedName" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_EnergySamples_PersonId_Date",
                table: "EnergySamples",
                columns: new[] { "PersonId", "Date" });

            migrationBuilder.CreateIndex(
                name: "IX_EnergySamples_PersonId_Kind_Start_End",
                table: "EnergySamples",
                columns: new[] { "PersonId", "Kind", "Start", "End" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Cooks_PersonId",
                table: "Cooks",
                column: "PersonId");

            migrationBuilder.AddForeignKey(
                name: "FK_BodyProfiles_People_PersonId",
                table: "BodyProfiles",
                column: "PersonId",
                principalTable: "People",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_Cooks_People_PersonId",
                table: "Cooks",
                column: "PersonId",
                principalTable: "People",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_EnergySamples_People_PersonId",
                table: "EnergySamples",
                column: "PersonId",
                principalTable: "People",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_FoodFavorites_People_PersonId",
                table: "FoodFavorites",
                column: "PersonId",
                principalTable: "People",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_HealthSyncs_People_PersonId",
                table: "HealthSyncs",
                column: "PersonId",
                principalTable: "People",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_PlanEntries_People_PersonId",
                table: "PlanEntries",
                column: "PersonId",
                principalTable: "People",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_WeightEntries_People_PersonId",
                table: "WeightEntries",
                column: "PersonId",
                principalTable: "People",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_Workouts_People_PersonId",
                table: "Workouts",
                column: "PersonId",
                principalTable: "People",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_BodyProfiles_People_PersonId",
                table: "BodyProfiles");

            migrationBuilder.DropForeignKey(
                name: "FK_Cooks_People_PersonId",
                table: "Cooks");

            migrationBuilder.DropForeignKey(
                name: "FK_EnergySamples_People_PersonId",
                table: "EnergySamples");

            migrationBuilder.DropForeignKey(
                name: "FK_FoodFavorites_People_PersonId",
                table: "FoodFavorites");

            migrationBuilder.DropForeignKey(
                name: "FK_HealthSyncs_People_PersonId",
                table: "HealthSyncs");

            migrationBuilder.DropForeignKey(
                name: "FK_PlanEntries_People_PersonId",
                table: "PlanEntries");

            migrationBuilder.DropForeignKey(
                name: "FK_WeightEntries_People_PersonId",
                table: "WeightEntries");

            migrationBuilder.DropForeignKey(
                name: "FK_Workouts_People_PersonId",
                table: "Workouts");

            migrationBuilder.DropTable(
                name: "Caterings");

            migrationBuilder.DropTable(
                name: "People");

            migrationBuilder.DropIndex(
                name: "IX_Workouts_PersonId_Date",
                table: "Workouts");

            migrationBuilder.DropIndex(
                name: "IX_Workouts_PersonId_ExternalKey",
                table: "Workouts");

            migrationBuilder.DropIndex(
                name: "IX_WeightEntries_PersonId_Date",
                table: "WeightEntries");

            migrationBuilder.DropIndex(
                name: "IX_PlanEntries_PersonId_Date",
                table: "PlanEntries");

            migrationBuilder.DropIndex(
                name: "IX_FoodFavorites_PersonId_NormalizedName",
                table: "FoodFavorites");

            migrationBuilder.DropIndex(
                name: "IX_EnergySamples_PersonId_Date",
                table: "EnergySamples");

            migrationBuilder.DropIndex(
                name: "IX_EnergySamples_PersonId_Kind_Start_End",
                table: "EnergySamples");

            migrationBuilder.DropIndex(
                name: "IX_Cooks_PersonId",
                table: "Cooks");

            migrationBuilder.DropColumn(
                name: "PersonId",
                table: "Workouts");

            migrationBuilder.DropColumn(
                name: "PersonId",
                table: "WeightEntries");

            migrationBuilder.DropColumn(
                name: "IsCatering",
                table: "PlanEntries");

            migrationBuilder.DropColumn(
                name: "PersonId",
                table: "PlanEntries");

            migrationBuilder.DropColumn(
                name: "PersonId",
                table: "FoodFavorites");

            migrationBuilder.DropColumn(
                name: "PersonId",
                table: "EnergySamples");

            migrationBuilder.DropColumn(
                name: "PersonId",
                table: "Cooks");

            migrationBuilder.RenameColumn(
                name: "PersonId",
                table: "HealthSyncs",
                newName: "Id");

            migrationBuilder.RenameColumn(
                name: "PersonId",
                table: "BodyProfiles",
                newName: "Id");

            migrationBuilder.CreateIndex(
                name: "IX_Workouts_Date",
                table: "Workouts",
                column: "Date");

            migrationBuilder.CreateIndex(
                name: "IX_Workouts_ExternalKey",
                table: "Workouts",
                column: "ExternalKey",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_WeightEntries_Date",
                table: "WeightEntries",
                column: "Date",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_FoodFavorites_NormalizedName",
                table: "FoodFavorites",
                column: "NormalizedName",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_EnergySamples_Date",
                table: "EnergySamples",
                column: "Date");

            migrationBuilder.CreateIndex(
                name: "IX_EnergySamples_Kind_Start_End",
                table: "EnergySamples",
                columns: new[] { "Kind", "Start", "End" },
                unique: true);
        }
    }
}
