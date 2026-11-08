using System;
using System.Collections.Generic;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Mise.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class TrainingCatalog : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "Exercises",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    SourceId = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    NameEn = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    NamePl = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    Category = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: false),
                    Level = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Force = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: true),
                    Mechanic = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: true),
                    Equipment = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    PrimaryMuscles = table.Column<List<string>>(type: "text[]", nullable: false),
                    SecondaryMuscles = table.Column<List<string>>(type: "text[]", nullable: false),
                    InstructionsEn = table.Column<List<string>>(type: "text[]", nullable: false),
                    InstructionsPl = table.Column<List<string>>(type: "text[]", nullable: false),
                    TipsPl = table.Column<List<string>>(type: "text[]", nullable: false),
                    MistakesPl = table.Column<List<string>>(type: "text[]", nullable: false),
                    YoutubeId = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: true),
                    VideoStartSeconds = table.Column<int>(type: "integer", nullable: true),
                    VideoTitle = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: true),
                    VideoChannel = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    ImagePaths = table.Column<List<string>>(type: "text[]", nullable: false),
                    IsTimed = table.Column<bool>(type: "boolean", nullable: false),
                    Hidden = table.Column<bool>(type: "boolean", nullable: false),
                    EnrichedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Exercises", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Exercises_SourceId",
                table: "Exercises",
                column: "SourceId",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "Exercises");
        }
    }
}
