using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Mise.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class Households : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_SupplyItems_Checked",
                table: "SupplyItems");

            migrationBuilder.DropIndex(
                name: "IX_SupplyFavorites_NormalizedName",
                table: "SupplyFavorites");

            migrationBuilder.DropIndex(
                name: "IX_ReceiptNameMappings_Merchant_NormalizedName",
                table: "ReceiptNameMappings");

            migrationBuilder.DropIndex(
                name: "IX_ProfileAnswers_Key",
                table: "ProfileAnswers");

            migrationBuilder.DropIndex(
                name: "IX_PlanEntries_Date_Slot",
                table: "PlanEntries");

            migrationBuilder.DropIndex(
                name: "IX_CookLog_CookedAt",
                table: "CookLog");

            migrationBuilder.AddColumn<int>(
                name: "HouseholdId",
                table: "Workouts",
                type: "integer",
                nullable: false,
                defaultValue: 1);

            migrationBuilder.AddColumn<int>(
                name: "HouseholdId",
                table: "WeightEntries",
                type: "integer",
                nullable: false,
                defaultValue: 1);

            migrationBuilder.AddColumn<int>(
                name: "HouseholdId",
                table: "TrainingPrograms",
                type: "integer",
                nullable: false,
                defaultValue: 1);

            migrationBuilder.AddColumn<int>(
                name: "HouseholdId",
                table: "TrainingProfiles",
                type: "integer",
                nullable: false,
                defaultValue: 1);

            migrationBuilder.AddColumn<int>(
                name: "HouseholdId",
                table: "SupplyItems",
                type: "integer",
                nullable: false,
                defaultValue: 1);

            migrationBuilder.AddColumn<int>(
                name: "HouseholdId",
                table: "SupplyFavorites",
                type: "integer",
                nullable: false,
                defaultValue: 1);

            migrationBuilder.AddColumn<int>(
                name: "HouseholdId",
                table: "ShoppingItems",
                type: "integer",
                nullable: false,
                defaultValue: 1);

            migrationBuilder.AddColumn<int>(
                name: "HouseholdId",
                table: "Recipes",
                type: "integer",
                nullable: false,
                defaultValue: 1);

            migrationBuilder.AddColumn<int>(
                name: "HouseholdId",
                table: "ReceiptNameMappings",
                type: "integer",
                nullable: false,
                defaultValue: 1);

            migrationBuilder.AddColumn<int>(
                name: "HouseholdId",
                table: "ProfileAnswers",
                type: "integer",
                nullable: false,
                defaultValue: 1);

            migrationBuilder.AddColumn<int>(
                name: "HouseholdId",
                table: "Preferences",
                type: "integer",
                nullable: false,
                defaultValue: 1);

            migrationBuilder.AddColumn<int>(
                name: "HouseholdId",
                table: "PlanEntries",
                type: "integer",
                nullable: false,
                defaultValue: 1);

            migrationBuilder.AlterColumn<int>(
                name: "Id",
                table: "People",
                type: "integer",
                nullable: false,
                oldClrType: typeof(int),
                oldType: "integer")
                .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "CreatedAt",
                table: "People",
                type: "timestamp with time zone",
                nullable: false,
                defaultValueSql: "now()");

            migrationBuilder.AddColumn<int>(
                name: "HouseholdId",
                table: "People",
                type: "integer",
                nullable: false,
                defaultValue: 1);

            migrationBuilder.AddColumn<int>(
                name: "HouseholdId",
                table: "PantryItems",
                type: "integer",
                nullable: false,
                defaultValue: 1);

            migrationBuilder.AddColumn<int>(
                name: "HouseholdId",
                table: "HealthSyncs",
                type: "integer",
                nullable: false,
                defaultValue: 1);

            migrationBuilder.AddColumn<int>(
                name: "HouseholdId",
                table: "FoodFavorites",
                type: "integer",
                nullable: false,
                defaultValue: 1);

            migrationBuilder.AddColumn<int>(
                name: "HouseholdId",
                table: "Exercises",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "HouseholdId",
                table: "EnergySamples",
                type: "integer",
                nullable: false,
                defaultValue: 1);

            migrationBuilder.AddColumn<int>(
                name: "HouseholdId",
                table: "Cooks",
                type: "integer",
                nullable: false,
                defaultValue: 1);

            migrationBuilder.AddColumn<int>(
                name: "HouseholdId",
                table: "CookLog",
                type: "integer",
                nullable: false,
                defaultValue: 1);

            migrationBuilder.AddColumn<int>(
                name: "HouseholdId",
                table: "ChatMessages",
                type: "integer",
                nullable: false,
                defaultValue: 1);

            migrationBuilder.AddColumn<int>(
                name: "HouseholdId",
                table: "Caterings",
                type: "integer",
                nullable: false,
                defaultValue: 1);

            migrationBuilder.AddColumn<int>(
                name: "HouseholdId",
                table: "BodyProfiles",
                type: "integer",
                nullable: false,
                defaultValue: 1);

            migrationBuilder.CreateTable(
                name: "Households",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    Name = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    SousEnabled = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Households", x => x.Id);
                });

            // Everything that existed before households is the first household's ("Dom"), with Sous on.
            migrationBuilder.Sql("""INSERT INTO "Households" ("Id", "Name", "SousEnabled", "CreatedAt") VALUES (1, 'Dom', TRUE, now());""");
            // Explicit ids never advance identity sequences; move them past the existing rows.
            migrationBuilder.Sql("""SELECT setval(pg_get_serial_sequence('"Households"', 'Id'), 2, false);""");
            migrationBuilder.Sql("""SELECT setval(pg_get_serial_sequence('"People"', 'Id'), COALESCE((SELECT MAX("Id") FROM "People"), 0) + 1, false);""");
            migrationBuilder.Sql("""SELECT setval(pg_get_serial_sequence('"Preferences"', 'Id'), COALESCE((SELECT MAX("Id") FROM "Preferences"), 0) + 1, false);""");
            // Emails are matched lower-case and are unique from now on.
            migrationBuilder.Sql("""UPDATE "People" SET "Email" = lower(trim("Email")) WHERE "Email" IS NOT NULL;""");

            migrationBuilder.CreateTable(
                name: "ApiKeys",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    HouseholdId = table.Column<int>(type: "integer", nullable: false),
                    PersonId = table.Column<int>(type: "integer", nullable: false),
                    Name = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    KeyHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    Prefix = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    LastUsedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    RevokedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ApiKeys", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ApiKeys_Households_HouseholdId",
                        column: x => x.HouseholdId,
                        principalTable: "Households",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ApiKeys_People_PersonId",
                        column: x => x.PersonId,
                        principalTable: "People",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Workouts_HouseholdId",
                table: "Workouts",
                column: "HouseholdId");

            migrationBuilder.CreateIndex(
                name: "IX_WeightEntries_HouseholdId",
                table: "WeightEntries",
                column: "HouseholdId");

            migrationBuilder.CreateIndex(
                name: "IX_TrainingPrograms_HouseholdId",
                table: "TrainingPrograms",
                column: "HouseholdId");

            migrationBuilder.CreateIndex(
                name: "IX_TrainingProfiles_HouseholdId",
                table: "TrainingProfiles",
                column: "HouseholdId");

            migrationBuilder.CreateIndex(
                name: "IX_SupplyItems_HouseholdId_Checked",
                table: "SupplyItems",
                columns: new[] { "HouseholdId", "Checked" });

            migrationBuilder.CreateIndex(
                name: "IX_SupplyFavorites_HouseholdId_NormalizedName",
                table: "SupplyFavorites",
                columns: new[] { "HouseholdId", "NormalizedName" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ShoppingItems_HouseholdId",
                table: "ShoppingItems",
                column: "HouseholdId");

            migrationBuilder.CreateIndex(
                name: "IX_Recipes_HouseholdId",
                table: "Recipes",
                column: "HouseholdId");

            migrationBuilder.CreateIndex(
                name: "IX_ReceiptNameMappings_HouseholdId_Merchant_NormalizedName",
                table: "ReceiptNameMappings",
                columns: new[] { "HouseholdId", "Merchant", "NormalizedName" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ProfileAnswers_HouseholdId_Key",
                table: "ProfileAnswers",
                columns: new[] { "HouseholdId", "Key" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Preferences_HouseholdId",
                table: "Preferences",
                column: "HouseholdId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_PlanEntries_HouseholdId_Date_Slot",
                table: "PlanEntries",
                columns: new[] { "HouseholdId", "Date", "Slot" });

            migrationBuilder.CreateIndex(
                name: "IX_People_Email",
                table: "People",
                column: "Email",
                unique: true,
                filter: "\"Email\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_People_HouseholdId",
                table: "People",
                column: "HouseholdId");

            migrationBuilder.CreateIndex(
                name: "IX_PantryItems_HouseholdId",
                table: "PantryItems",
                column: "HouseholdId");

            migrationBuilder.CreateIndex(
                name: "IX_HealthSyncs_HouseholdId",
                table: "HealthSyncs",
                column: "HouseholdId");

            migrationBuilder.CreateIndex(
                name: "IX_FoodFavorites_HouseholdId",
                table: "FoodFavorites",
                column: "HouseholdId");

            migrationBuilder.CreateIndex(
                name: "IX_Exercises_HouseholdId",
                table: "Exercises",
                column: "HouseholdId");

            migrationBuilder.CreateIndex(
                name: "IX_EnergySamples_HouseholdId",
                table: "EnergySamples",
                column: "HouseholdId");

            migrationBuilder.CreateIndex(
                name: "IX_Cooks_HouseholdId",
                table: "Cooks",
                column: "HouseholdId");

            migrationBuilder.CreateIndex(
                name: "IX_CookLog_HouseholdId_CookedAt",
                table: "CookLog",
                columns: new[] { "HouseholdId", "CookedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_ChatMessages_HouseholdId",
                table: "ChatMessages",
                column: "HouseholdId");

            migrationBuilder.CreateIndex(
                name: "IX_Caterings_HouseholdId",
                table: "Caterings",
                column: "HouseholdId");

            migrationBuilder.CreateIndex(
                name: "IX_BodyProfiles_HouseholdId",
                table: "BodyProfiles",
                column: "HouseholdId");

            migrationBuilder.CreateIndex(
                name: "IX_ApiKeys_HouseholdId",
                table: "ApiKeys",
                column: "HouseholdId");

            migrationBuilder.CreateIndex(
                name: "IX_ApiKeys_KeyHash",
                table: "ApiKeys",
                column: "KeyHash",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ApiKeys_PersonId",
                table: "ApiKeys",
                column: "PersonId");

            migrationBuilder.AddForeignKey(
                name: "FK_BodyProfiles_Households_HouseholdId",
                table: "BodyProfiles",
                column: "HouseholdId",
                principalTable: "Households",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_Caterings_Households_HouseholdId",
                table: "Caterings",
                column: "HouseholdId",
                principalTable: "Households",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_ChatMessages_Households_HouseholdId",
                table: "ChatMessages",
                column: "HouseholdId",
                principalTable: "Households",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_CookLog_Households_HouseholdId",
                table: "CookLog",
                column: "HouseholdId",
                principalTable: "Households",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_Cooks_Households_HouseholdId",
                table: "Cooks",
                column: "HouseholdId",
                principalTable: "Households",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_EnergySamples_Households_HouseholdId",
                table: "EnergySamples",
                column: "HouseholdId",
                principalTable: "Households",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_Exercises_Households_HouseholdId",
                table: "Exercises",
                column: "HouseholdId",
                principalTable: "Households",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_FoodFavorites_Households_HouseholdId",
                table: "FoodFavorites",
                column: "HouseholdId",
                principalTable: "Households",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_HealthSyncs_Households_HouseholdId",
                table: "HealthSyncs",
                column: "HouseholdId",
                principalTable: "Households",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_PantryItems_Households_HouseholdId",
                table: "PantryItems",
                column: "HouseholdId",
                principalTable: "Households",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_People_Households_HouseholdId",
                table: "People",
                column: "HouseholdId",
                principalTable: "Households",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_PlanEntries_Households_HouseholdId",
                table: "PlanEntries",
                column: "HouseholdId",
                principalTable: "Households",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_Preferences_Households_HouseholdId",
                table: "Preferences",
                column: "HouseholdId",
                principalTable: "Households",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_ProfileAnswers_Households_HouseholdId",
                table: "ProfileAnswers",
                column: "HouseholdId",
                principalTable: "Households",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_ReceiptNameMappings_Households_HouseholdId",
                table: "ReceiptNameMappings",
                column: "HouseholdId",
                principalTable: "Households",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_Recipes_Households_HouseholdId",
                table: "Recipes",
                column: "HouseholdId",
                principalTable: "Households",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_ShoppingItems_Households_HouseholdId",
                table: "ShoppingItems",
                column: "HouseholdId",
                principalTable: "Households",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_SupplyFavorites_Households_HouseholdId",
                table: "SupplyFavorites",
                column: "HouseholdId",
                principalTable: "Households",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_SupplyItems_Households_HouseholdId",
                table: "SupplyItems",
                column: "HouseholdId",
                principalTable: "Households",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_TrainingProfiles_Households_HouseholdId",
                table: "TrainingProfiles",
                column: "HouseholdId",
                principalTable: "Households",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_TrainingPrograms_Households_HouseholdId",
                table: "TrainingPrograms",
                column: "HouseholdId",
                principalTable: "Households",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_WeightEntries_Households_HouseholdId",
                table: "WeightEntries",
                column: "HouseholdId",
                principalTable: "Households",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_Workouts_Households_HouseholdId",
                table: "Workouts",
                column: "HouseholdId",
                principalTable: "Households",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_BodyProfiles_Households_HouseholdId",
                table: "BodyProfiles");

            migrationBuilder.DropForeignKey(
                name: "FK_Caterings_Households_HouseholdId",
                table: "Caterings");

            migrationBuilder.DropForeignKey(
                name: "FK_ChatMessages_Households_HouseholdId",
                table: "ChatMessages");

            migrationBuilder.DropForeignKey(
                name: "FK_CookLog_Households_HouseholdId",
                table: "CookLog");

            migrationBuilder.DropForeignKey(
                name: "FK_Cooks_Households_HouseholdId",
                table: "Cooks");

            migrationBuilder.DropForeignKey(
                name: "FK_EnergySamples_Households_HouseholdId",
                table: "EnergySamples");

            migrationBuilder.DropForeignKey(
                name: "FK_Exercises_Households_HouseholdId",
                table: "Exercises");

            migrationBuilder.DropForeignKey(
                name: "FK_FoodFavorites_Households_HouseholdId",
                table: "FoodFavorites");

            migrationBuilder.DropForeignKey(
                name: "FK_HealthSyncs_Households_HouseholdId",
                table: "HealthSyncs");

            migrationBuilder.DropForeignKey(
                name: "FK_PantryItems_Households_HouseholdId",
                table: "PantryItems");

            migrationBuilder.DropForeignKey(
                name: "FK_People_Households_HouseholdId",
                table: "People");

            migrationBuilder.DropForeignKey(
                name: "FK_PlanEntries_Households_HouseholdId",
                table: "PlanEntries");

            migrationBuilder.DropForeignKey(
                name: "FK_Preferences_Households_HouseholdId",
                table: "Preferences");

            migrationBuilder.DropForeignKey(
                name: "FK_ProfileAnswers_Households_HouseholdId",
                table: "ProfileAnswers");

            migrationBuilder.DropForeignKey(
                name: "FK_ReceiptNameMappings_Households_HouseholdId",
                table: "ReceiptNameMappings");

            migrationBuilder.DropForeignKey(
                name: "FK_Recipes_Households_HouseholdId",
                table: "Recipes");

            migrationBuilder.DropForeignKey(
                name: "FK_ShoppingItems_Households_HouseholdId",
                table: "ShoppingItems");

            migrationBuilder.DropForeignKey(
                name: "FK_SupplyFavorites_Households_HouseholdId",
                table: "SupplyFavorites");

            migrationBuilder.DropForeignKey(
                name: "FK_SupplyItems_Households_HouseholdId",
                table: "SupplyItems");

            migrationBuilder.DropForeignKey(
                name: "FK_TrainingProfiles_Households_HouseholdId",
                table: "TrainingProfiles");

            migrationBuilder.DropForeignKey(
                name: "FK_TrainingPrograms_Households_HouseholdId",
                table: "TrainingPrograms");

            migrationBuilder.DropForeignKey(
                name: "FK_WeightEntries_Households_HouseholdId",
                table: "WeightEntries");

            migrationBuilder.DropForeignKey(
                name: "FK_Workouts_Households_HouseholdId",
                table: "Workouts");

            migrationBuilder.DropTable(
                name: "ApiKeys");

            migrationBuilder.DropTable(
                name: "Households");

            migrationBuilder.DropIndex(
                name: "IX_Workouts_HouseholdId",
                table: "Workouts");

            migrationBuilder.DropIndex(
                name: "IX_WeightEntries_HouseholdId",
                table: "WeightEntries");

            migrationBuilder.DropIndex(
                name: "IX_TrainingPrograms_HouseholdId",
                table: "TrainingPrograms");

            migrationBuilder.DropIndex(
                name: "IX_TrainingProfiles_HouseholdId",
                table: "TrainingProfiles");

            migrationBuilder.DropIndex(
                name: "IX_SupplyItems_HouseholdId_Checked",
                table: "SupplyItems");

            migrationBuilder.DropIndex(
                name: "IX_SupplyFavorites_HouseholdId_NormalizedName",
                table: "SupplyFavorites");

            migrationBuilder.DropIndex(
                name: "IX_ShoppingItems_HouseholdId",
                table: "ShoppingItems");

            migrationBuilder.DropIndex(
                name: "IX_Recipes_HouseholdId",
                table: "Recipes");

            migrationBuilder.DropIndex(
                name: "IX_ReceiptNameMappings_HouseholdId_Merchant_NormalizedName",
                table: "ReceiptNameMappings");

            migrationBuilder.DropIndex(
                name: "IX_ProfileAnswers_HouseholdId_Key",
                table: "ProfileAnswers");

            migrationBuilder.DropIndex(
                name: "IX_Preferences_HouseholdId",
                table: "Preferences");

            migrationBuilder.DropIndex(
                name: "IX_PlanEntries_HouseholdId_Date_Slot",
                table: "PlanEntries");

            migrationBuilder.DropIndex(
                name: "IX_People_Email",
                table: "People");

            migrationBuilder.DropIndex(
                name: "IX_People_HouseholdId",
                table: "People");

            migrationBuilder.DropIndex(
                name: "IX_PantryItems_HouseholdId",
                table: "PantryItems");

            migrationBuilder.DropIndex(
                name: "IX_HealthSyncs_HouseholdId",
                table: "HealthSyncs");

            migrationBuilder.DropIndex(
                name: "IX_FoodFavorites_HouseholdId",
                table: "FoodFavorites");

            migrationBuilder.DropIndex(
                name: "IX_Exercises_HouseholdId",
                table: "Exercises");

            migrationBuilder.DropIndex(
                name: "IX_EnergySamples_HouseholdId",
                table: "EnergySamples");

            migrationBuilder.DropIndex(
                name: "IX_Cooks_HouseholdId",
                table: "Cooks");

            migrationBuilder.DropIndex(
                name: "IX_CookLog_HouseholdId_CookedAt",
                table: "CookLog");

            migrationBuilder.DropIndex(
                name: "IX_ChatMessages_HouseholdId",
                table: "ChatMessages");

            migrationBuilder.DropIndex(
                name: "IX_Caterings_HouseholdId",
                table: "Caterings");

            migrationBuilder.DropIndex(
                name: "IX_BodyProfiles_HouseholdId",
                table: "BodyProfiles");

            migrationBuilder.DropColumn(
                name: "HouseholdId",
                table: "Workouts");

            migrationBuilder.DropColumn(
                name: "HouseholdId",
                table: "WeightEntries");

            migrationBuilder.DropColumn(
                name: "HouseholdId",
                table: "TrainingPrograms");

            migrationBuilder.DropColumn(
                name: "HouseholdId",
                table: "TrainingProfiles");

            migrationBuilder.DropColumn(
                name: "HouseholdId",
                table: "SupplyItems");

            migrationBuilder.DropColumn(
                name: "HouseholdId",
                table: "SupplyFavorites");

            migrationBuilder.DropColumn(
                name: "HouseholdId",
                table: "ShoppingItems");

            migrationBuilder.DropColumn(
                name: "HouseholdId",
                table: "Recipes");

            migrationBuilder.DropColumn(
                name: "HouseholdId",
                table: "ReceiptNameMappings");

            migrationBuilder.DropColumn(
                name: "HouseholdId",
                table: "ProfileAnswers");

            migrationBuilder.DropColumn(
                name: "HouseholdId",
                table: "Preferences");

            migrationBuilder.DropColumn(
                name: "HouseholdId",
                table: "PlanEntries");

            migrationBuilder.DropColumn(
                name: "CreatedAt",
                table: "People");

            migrationBuilder.DropColumn(
                name: "HouseholdId",
                table: "People");

            migrationBuilder.DropColumn(
                name: "HouseholdId",
                table: "PantryItems");

            migrationBuilder.DropColumn(
                name: "HouseholdId",
                table: "HealthSyncs");

            migrationBuilder.DropColumn(
                name: "HouseholdId",
                table: "FoodFavorites");

            migrationBuilder.DropColumn(
                name: "HouseholdId",
                table: "Exercises");

            migrationBuilder.DropColumn(
                name: "HouseholdId",
                table: "EnergySamples");

            migrationBuilder.DropColumn(
                name: "HouseholdId",
                table: "Cooks");

            migrationBuilder.DropColumn(
                name: "HouseholdId",
                table: "CookLog");

            migrationBuilder.DropColumn(
                name: "HouseholdId",
                table: "ChatMessages");

            migrationBuilder.DropColumn(
                name: "HouseholdId",
                table: "Caterings");

            migrationBuilder.DropColumn(
                name: "HouseholdId",
                table: "BodyProfiles");

            migrationBuilder.AlterColumn<int>(
                name: "Id",
                table: "People",
                type: "integer",
                nullable: false,
                oldClrType: typeof(int),
                oldType: "integer")
                .OldAnnotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn);

            migrationBuilder.CreateIndex(
                name: "IX_SupplyItems_Checked",
                table: "SupplyItems",
                column: "Checked");

            migrationBuilder.CreateIndex(
                name: "IX_SupplyFavorites_NormalizedName",
                table: "SupplyFavorites",
                column: "NormalizedName",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ReceiptNameMappings_Merchant_NormalizedName",
                table: "ReceiptNameMappings",
                columns: new[] { "Merchant", "NormalizedName" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ProfileAnswers_Key",
                table: "ProfileAnswers",
                column: "Key",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_PlanEntries_Date_Slot",
                table: "PlanEntries",
                columns: new[] { "Date", "Slot" });

            migrationBuilder.CreateIndex(
                name: "IX_CookLog_CookedAt",
                table: "CookLog",
                column: "CookedAt");
        }
    }
}
