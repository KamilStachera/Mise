using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Mise.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AuditIndexes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_ShoppingItems_HouseholdId",
                table: "ShoppingItems");

            migrationBuilder.DropIndex(
                name: "IX_FoodFavorites_HouseholdId",
                table: "FoodFavorites");

            migrationBuilder.DropIndex(
                name: "IX_Cooks_PersonId",
                table: "Cooks");

            migrationBuilder.DropIndex(
                name: "IX_ChatMessages_HouseholdId",
                table: "ChatMessages");

            migrationBuilder.CreateIndex(
                name: "IX_ShoppingItems_HouseholdId_Checked",
                table: "ShoppingItems",
                columns: new[] { "HouseholdId", "Checked" });

            migrationBuilder.CreateIndex(
                name: "IX_Recipes_ImagePath",
                table: "Recipes",
                column: "ImagePath");

            migrationBuilder.CreateIndex(
                name: "IX_RecipeImages_Path",
                table: "RecipeImages",
                column: "Path");

            migrationBuilder.CreateIndex(
                name: "IX_HealthSyncs_Token",
                table: "HealthSyncs",
                column: "Token",
                unique: true,
                filter: "\"Token\" <> ''");

            migrationBuilder.CreateIndex(
                name: "IX_FoodFavorites_HouseholdId_Barcode",
                table: "FoodFavorites",
                columns: new[] { "HouseholdId", "Barcode" });

            migrationBuilder.CreateIndex(
                name: "IX_Exercises_Hidden_EnrichedAt",
                table: "Exercises",
                columns: new[] { "Hidden", "EnrichedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_Exercises_PrimaryMuscles",
                table: "Exercises",
                column: "PrimaryMuscles")
                .Annotation("Npgsql:IndexMethod", "gin");

            migrationBuilder.CreateIndex(
                name: "IX_Exercises_SecondaryMuscles",
                table: "Exercises",
                column: "SecondaryMuscles")
                .Annotation("Npgsql:IndexMethod", "gin");

            migrationBuilder.CreateIndex(
                name: "IX_EnergySamples_PersonId_Start",
                table: "EnergySamples",
                columns: new[] { "PersonId", "Start" });

            migrationBuilder.CreateIndex(
                name: "IX_Cooks_PersonId_Date",
                table: "Cooks",
                columns: new[] { "PersonId", "Date" });

            migrationBuilder.CreateIndex(
                name: "IX_ChatMessages_CreatedAt",
                table: "ChatMessages",
                column: "CreatedAt");

            migrationBuilder.CreateIndex(
                name: "IX_ChatMessages_HouseholdId_SessionId_CreatedAt",
                table: "ChatMessages",
                columns: new[] { "HouseholdId", "SessionId", "CreatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_AuditEvents_Kind",
                table: "AuditEvents",
                column: "Kind");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_ShoppingItems_HouseholdId_Checked",
                table: "ShoppingItems");

            migrationBuilder.DropIndex(
                name: "IX_Recipes_ImagePath",
                table: "Recipes");

            migrationBuilder.DropIndex(
                name: "IX_RecipeImages_Path",
                table: "RecipeImages");

            migrationBuilder.DropIndex(
                name: "IX_HealthSyncs_Token",
                table: "HealthSyncs");

            migrationBuilder.DropIndex(
                name: "IX_FoodFavorites_HouseholdId_Barcode",
                table: "FoodFavorites");

            migrationBuilder.DropIndex(
                name: "IX_Exercises_Hidden_EnrichedAt",
                table: "Exercises");

            migrationBuilder.DropIndex(
                name: "IX_Exercises_PrimaryMuscles",
                table: "Exercises");

            migrationBuilder.DropIndex(
                name: "IX_Exercises_SecondaryMuscles",
                table: "Exercises");

            migrationBuilder.DropIndex(
                name: "IX_EnergySamples_PersonId_Start",
                table: "EnergySamples");

            migrationBuilder.DropIndex(
                name: "IX_Cooks_PersonId_Date",
                table: "Cooks");

            migrationBuilder.DropIndex(
                name: "IX_ChatMessages_CreatedAt",
                table: "ChatMessages");

            migrationBuilder.DropIndex(
                name: "IX_ChatMessages_HouseholdId_SessionId_CreatedAt",
                table: "ChatMessages");

            migrationBuilder.DropIndex(
                name: "IX_AuditEvents_Kind",
                table: "AuditEvents");

            migrationBuilder.CreateIndex(
                name: "IX_ShoppingItems_HouseholdId",
                table: "ShoppingItems",
                column: "HouseholdId");

            migrationBuilder.CreateIndex(
                name: "IX_FoodFavorites_HouseholdId",
                table: "FoodFavorites",
                column: "HouseholdId");

            migrationBuilder.CreateIndex(
                name: "IX_Cooks_PersonId",
                table: "Cooks",
                column: "PersonId");

            migrationBuilder.CreateIndex(
                name: "IX_ChatMessages_HouseholdId",
                table: "ChatMessages",
                column: "HouseholdId");
        }
    }
}
