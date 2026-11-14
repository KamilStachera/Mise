using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Mise.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class FirstSteps : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "FirstStepsDismissedAt",
                table: "People",
                type: "timestamp with time zone",
                nullable: true);

            // Everyone already using Pichci knows their way around: only people who join from now
            // on see the checklist.
            migrationBuilder.Sql("""UPDATE "People" SET "FirstStepsDismissedAt" = now();""");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "FirstStepsDismissedAt",
                table: "People");
        }
    }
}
