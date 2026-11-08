using System;
using System.Collections.Generic;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Mise.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class InviteCodes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "InviteCodes",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Kind = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    CodeHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    HouseholdId = table.Column<int>(type: "integer", nullable: true),
                    HouseholdName = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: true),
                    SourceHouseholdId = table.Column<int>(type: "integer", nullable: true),
                    Starter = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    StarterSources = table.Column<List<string>>(type: "text[]", nullable: false),
                    CreatedByPersonId = table.Column<int>(type: "integer", nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    ExpiresAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UsedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    UsedByPersonId = table.Column<int>(type: "integer", nullable: true),
                    CreatedHouseholdId = table.Column<int>(type: "integer", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_InviteCodes", x => x.Id);
                    table.ForeignKey(
                        name: "FK_InviteCodes_Households_HouseholdId",
                        column: x => x.HouseholdId,
                        principalTable: "Households",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_InviteCodes_CodeHash",
                table: "InviteCodes",
                column: "CodeHash",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_InviteCodes_HouseholdId",
                table: "InviteCodes",
                column: "HouseholdId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "InviteCodes");
        }
    }
}
