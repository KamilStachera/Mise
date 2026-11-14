using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Mise.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AdminPanel : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "BlockedAt",
                table: "People",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "IsAdmin",
                table: "People",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "LastSeenAt",
                table: "People",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Role",
                table: "People",
                type: "character varying(16)",
                maxLength: 16,
                nullable: false,
                defaultValue: "Owner");

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "RevokedAt",
                table: "InviteCodes",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Role",
                table: "InviteCodes",
                type: "character varying(16)",
                maxLength: 16,
                nullable: false,
                defaultValue: "Member");

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "BlockedAt",
                table: "Households",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "AuditEvents",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    At = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    ActorPersonId = table.Column<int>(type: "integer", nullable: true),
                    ActorName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    HouseholdId = table.Column<int>(type: "integer", nullable: true),
                    TargetPersonId = table.Column<int>(type: "integer", nullable: true),
                    Kind = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    Summary = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AuditEvents", x => x.Id);
                });

            // Everyone who existed before roles ran their household: owners. New-household codes make owners.
            migrationBuilder.Sql("""UPDATE "InviteCodes" SET "Role" = 'Owner' WHERE "Kind" = 'NewHousehold';""");

            migrationBuilder.CreateIndex(
                name: "IX_AuditEvents_At",
                table: "AuditEvents",
                column: "At");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "AuditEvents");

            migrationBuilder.DropColumn(
                name: "BlockedAt",
                table: "People");

            migrationBuilder.DropColumn(
                name: "IsAdmin",
                table: "People");

            migrationBuilder.DropColumn(
                name: "LastSeenAt",
                table: "People");

            migrationBuilder.DropColumn(
                name: "Role",
                table: "People");

            migrationBuilder.DropColumn(
                name: "RevokedAt",
                table: "InviteCodes");

            migrationBuilder.DropColumn(
                name: "Role",
                table: "InviteCodes");

            migrationBuilder.DropColumn(
                name: "BlockedAt",
                table: "Households");
        }
    }
}
