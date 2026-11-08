using System;
using System.Collections.Generic;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Mise.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class TrainingPrograms : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "TrainingProfiles",
                columns: table => new
                {
                    PersonId = table.Column<int>(type: "integer", nullable: false),
                    Goal = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Level = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    DaysPerWeek = table.Column<int>(type: "integer", nullable: false),
                    MinutesPerSession = table.Column<int>(type: "integer", nullable: false),
                    PreferredWeekdays = table.Column<int>(type: "integer", nullable: false),
                    Location = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: false),
                    HomeEquipment = table.Column<List<string>>(type: "text[]", nullable: false),
                    Styles = table.Column<List<string>>(type: "text[]", nullable: false),
                    Limitations = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: false),
                    Dislikes = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: false),
                    Notes = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TrainingProfiles", x => x.PersonId);
                    table.ForeignKey(
                        name: "FK_TrainingProfiles_People_PersonId",
                        column: x => x.PersonId,
                        principalTable: "People",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "TrainingPrograms",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    PersonId = table.Column<int>(type: "integer", nullable: false),
                    Name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    Description = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: false),
                    Rationale = table.Column<string>(type: "character varying(4000)", maxLength: 4000, nullable: false),
                    StartDate = table.Column<DateOnly>(type: "date", nullable: false),
                    Weeks = table.Column<int>(type: "integer", nullable: false),
                    Status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    CreatedBy = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TrainingPrograms", x => x.Id);
                    table.ForeignKey(
                        name: "FK_TrainingPrograms_People_PersonId",
                        column: x => x.PersonId,
                        principalTable: "People",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "ProgramDays",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ProgramId = table.Column<Guid>(type: "uuid", nullable: false),
                    Week = table.Column<int>(type: "integer", nullable: false),
                    Weekday = table.Column<int>(type: "integer", nullable: false),
                    Name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    Kind = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Location = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: false),
                    Notes = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: false),
                    VideoYoutubeId = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: true),
                    VideoTitle = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: true),
                    VideoMinutes = table.Column<int>(type: "integer", nullable: true),
                    WorkoutType = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ProgramDays", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ProgramDays_TrainingPrograms_ProgramId",
                        column: x => x.ProgramId,
                        principalTable: "TrainingPrograms",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "ProgramExercises",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ProgramDayId = table.Column<Guid>(type: "uuid", nullable: false),
                    Order = table.Column<int>(type: "integer", nullable: false),
                    ExerciseId = table.Column<Guid>(type: "uuid", nullable: false),
                    Sets = table.Column<int>(type: "integer", nullable: false),
                    RepsMin = table.Column<int>(type: "integer", nullable: true),
                    RepsMax = table.Column<int>(type: "integer", nullable: true),
                    Seconds = table.Column<int>(type: "integer", nullable: true),
                    RestSeconds = table.Column<int>(type: "integer", nullable: false),
                    TargetKg = table.Column<decimal>(type: "numeric(6,2)", precision: 6, scale: 2, nullable: true),
                    Notes = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    SupersetGroup = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ProgramExercises", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ProgramExercises_Exercises_ExerciseId",
                        column: x => x.ExerciseId,
                        principalTable: "Exercises",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ProgramExercises_ProgramDays_ProgramDayId",
                        column: x => x.ProgramDayId,
                        principalTable: "ProgramDays",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ProgramDays_ProgramId_Week_Weekday",
                table: "ProgramDays",
                columns: new[] { "ProgramId", "Week", "Weekday" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ProgramExercises_ExerciseId",
                table: "ProgramExercises",
                column: "ExerciseId");

            migrationBuilder.CreateIndex(
                name: "IX_ProgramExercises_ProgramDayId",
                table: "ProgramExercises",
                column: "ProgramDayId");

            migrationBuilder.CreateIndex(
                name: "IX_TrainingPrograms_PersonId_Active",
                table: "TrainingPrograms",
                column: "PersonId",
                unique: true,
                filter: "\"Status\" = 'Active'");

            migrationBuilder.CreateIndex(
                name: "IX_TrainingPrograms_PersonId_Status",
                table: "TrainingPrograms",
                columns: new[] { "PersonId", "Status" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ProgramExercises");

            migrationBuilder.DropTable(
                name: "TrainingProfiles");

            migrationBuilder.DropTable(
                name: "ProgramDays");

            migrationBuilder.DropTable(
                name: "TrainingPrograms");
        }
    }
}
