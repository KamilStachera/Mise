using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Mise.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class ApproximatePantryReliability : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "ReliabilityUpdatedAt",
                table: "PantryItems",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "ReliableQuantity",
                table: "PantryItems",
                type: "numeric(10,2)",
                precision: 10,
                scale: 2,
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.CreateTable(
                name: "ReceiptNameMappings",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Merchant = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    RawName = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    NormalizedName = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    PantryItemId = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ReceiptNameMappings", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ReceiptNameMappings_PantryItems_PantryItemId",
                        column: x => x.PantryItemId,
                        principalTable: "PantryItems",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ReceiptNameMappings_Merchant_NormalizedName",
                table: "ReceiptNameMappings",
                columns: new[] { "Merchant", "NormalizedName" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ReceiptNameMappings_PantryItemId",
                table: "ReceiptNameMappings",
                column: "PantryItemId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ReceiptNameMappings");

            migrationBuilder.DropColumn(
                name: "ReliabilityUpdatedAt",
                table: "PantryItems");

            migrationBuilder.DropColumn(
                name: "ReliableQuantity",
                table: "PantryItems");
        }
    }
}
