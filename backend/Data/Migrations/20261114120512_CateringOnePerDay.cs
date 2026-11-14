using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Mise.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class CateringOnePerDay : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Parallel page loads used to materialize the same catering backlog 2–3 times (copies
            // created milliseconds apart). Keep the earliest entry per person and day, drop the rest.
            migrationBuilder.Sql("""
                DELETE FROM "PlanEntries" p
                USING "PlanEntries" q
                WHERE p."IsCatering" AND q."IsCatering"
                  AND p."PersonId" = q."PersonId" AND p."Date" = q."Date"
                  AND (p."CreatedAt", p."Id") > (q."CreatedAt", q."Id");
                """);

            migrationBuilder.CreateIndex(
                name: "IX_PlanEntries_PersonId_Date_Catering",
                table: "PlanEntries",
                columns: new[] { "PersonId", "Date" },
                unique: true,
                filter: "\"IsCatering\"");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_PlanEntries_PersonId_Date_Catering",
                table: "PlanEntries");
        }
    }
}
