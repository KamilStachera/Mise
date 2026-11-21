namespace Mise.Api.Features;

// ---- training: exercise catalog ----

public record ExerciseListItemDto(Guid Id, string Name, string NameEn, string? NamePl,
    string Category, string Level, string Equipment, IReadOnlyList<string> PrimaryMuscles,
    IReadOnlyList<string> SecondaryMuscles, bool IsTimed, bool HasVideo, bool Enriched,
    string? ThumbnailUrl);

public record ExerciseListDto(int Total, int EnrichedTotal, int CatalogTotal, IReadOnlyList<ExerciseListItemDto> Items);

/// <summary>Instructions = Polish when written, else English (InstructionsEn always present for agents).</summary>
public record ExerciseDetailDto(Guid Id, string? SourceId, string Name, string NameEn, string? NamePl,
    string Category, string Level, string? Force, string? Mechanic, string Equipment,
    IReadOnlyList<string> PrimaryMuscles, IReadOnlyList<string> SecondaryMuscles,
    IReadOnlyList<string> Instructions, bool InstructionsArePolish,
    IReadOnlyList<string> InstructionsEn, IReadOnlyList<string> InstructionsPl,
    IReadOnlyList<string> TipsPl, IReadOnlyList<string> MistakesPl,
    string? YoutubeId, int? VideoStartSeconds, string? VideoTitle, string? VideoChannel,
    IReadOnlyList<string> ImageUrls, bool IsTimed, bool Hidden, DateTimeOffset? EnrichedAt);

/// <summary>The background describer (GPT via Sous): on/off, mid-batch, last success, pause after an error.</summary>
public record ExerciseEnrichmentStatusDto(bool Enabled, bool Running, DateTimeOffset? LastRunAt,
    DateTimeOffset? PausedUntil, string? LastError);

public record ExerciseVocabularyDto(IReadOnlyList<string> Muscles, IReadOnlyList<string> Equipment,
    IReadOnlyList<string> Categories, IReadOnlyList<string> Levels, IReadOnlyList<string> Forces,
    IReadOnlyList<string> Mechanics);

/// <summary>
/// Partial update (PATCH / batch enrich): null = leave as is. Lists replace the whole list;
/// youtubeId "" clears the video. Id is only used by the batch endpoint.
/// </summary>
public record ExerciseEnrichInput(Guid? Id, string? NamePl, List<string>? InstructionsPl,
    List<string>? TipsPl, List<string>? MistakesPl, string? YoutubeId, int? VideoStartSeconds,
    bool? IsTimed, bool? Hidden, string? Level, string? Category, string? Equipment,
    List<string>? PrimaryMuscles, List<string>? SecondaryMuscles);

public record ExerciseEnrichBatchInput(List<ExerciseEnrichInput> Items);

public record ExerciseEnrichErrorDto(Guid? Id, string Error);

public record ExerciseEnrichResultDto(int Updated, IReadOnlyList<ExerciseEnrichErrorDto> Errors);

/// <summary>A custom exercise (pilates, mobility… not in free-exercise-db). NamePl required.</summary>
public record ExerciseCreateInput(string NamePl, string? NameEn, string? Category, string? Level,
    string? Equipment, List<string>? PrimaryMuscles, List<string>? SecondaryMuscles,
    List<string>? InstructionsPl, List<string>? TipsPl, List<string>? MistakesPl,
    string? YoutubeId, int? VideoStartSeconds, bool? IsTimed);

// ---- training: profile, programs, today (private, per person) ----

/// <summary>Configured = she has filled the questionnaire (a row exists).</summary>
public record TrainingProfileDto(bool Configured, string Goal, string Level, int DaysPerWeek, int MinutesPerSession,
    int PreferredWeekdays, string Location, IReadOnlyList<string> HomeEquipment, IReadOnlyList<string> Styles,
    string Limitations, string Dislikes, string Notes, DateTimeOffset? UpdatedAt);

public record TrainingProfileInput(string? Goal, string? Level, int? DaysPerWeek, int? MinutesPerSession,
    int? PreferredWeekdays, string? Location, List<string>? HomeEquipment, List<string>? Styles,
    string? Limitations, string? Dislikes, string? Notes);

public record ProgramExerciseDto(Guid Id, int Order, Guid ExerciseId, string Name, string NameEn, string Equipment,
    IReadOnlyList<string> PrimaryMuscles, bool IsTimed, bool HasVideo, string? ThumbnailUrl,
    int Sets, int? RepsMin, int? RepsMax, int? Seconds, int RestSeconds, decimal? TargetKg, string Notes,
    string? SupersetGroup);

public record ProgramVideoDto(string YoutubeId, string? Title, int? Minutes, string? WorkoutType);

public record ProgramDayDto(Guid Id, int Week, int Weekday, DateOnly Date, string Name, string Kind, string Location,
    string Notes, ProgramVideoDto? Video, IReadOnlyList<ProgramExerciseDto> Exercises,
    Guid? CompletedSessionId = null, DateTimeOffset? CompletedAt = null);

public record TrainingProgramDto(Guid Id, string Name, string Description, string Rationale, DateOnly StartDate,
    DateOnly EndDate, int Weeks, string Status, string CreatedBy, DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt,
    IReadOnlyList<ProgramDayDto> Days);

public record TrainingProgramSummaryDto(Guid Id, string Name, DateOnly StartDate, DateOnly EndDate, int Weeks,
    string Status, string CreatedBy, int DayCount, DateTimeOffset UpdatedAt);

/// <summary>Reps: repsMin–repsMax (or one of them); timed exercises: seconds instead.</summary>
public record ProgramExerciseInput(Guid ExerciseId, int? Sets, int? RepsMin, int? RepsMax, int? Seconds,
    int? RestSeconds, decimal? TargetKg, string? Notes, string? SupersetGroup);

/// <summary>Weekday 0 = Monday. Kind "exercises" needs exercises; "follow-along" needs videoYoutubeId.</summary>
public record ProgramDayInput(int Week, int Weekday, string? Name, string? Kind, string? Location, string? Notes,
    string? VideoYoutubeId, int? VideoMinutes, string? WorkoutType, List<ProgramExerciseInput>? Exercises);

public record TrainingProgramInput(string? Name, string? Description, string? Rationale, DateOnly? StartDate,
    int? Weeks, bool? Activate, string? CreatedBy, List<ProgramDayInput>? Days);

/// <summary>Status "active" archives the person's other active program.</summary>
public record TrainingProgramPatch(string? Name, string? Description, string? Rationale, DateOnly? StartDate, string? Status);

/// <summary>Null = unchanged. exerciseId swaps the slot; applyToFollowingWeeks also swaps it in later weeks' days of the same name.</summary>
public record ProgramExercisePatch(Guid? ExerciseId, int? Sets, int? RepsMin, int? RepsMax, int? Seconds,
    int? RestSeconds, decimal? TargetKg, string? Notes, bool? ApplyToFollowingWeeks, bool? ClearTargetKg);

/// <summary>
/// status: none (no active program) · before-start · scheduled (day = today's workout) ·
/// rest (no workout today) · finished (program ended). next = the next scheduled day after today.
/// </summary>
public record TrainingTodayDto(DateOnly Date, string Status, TrainingProgramSummaryDto? Program, int? Week,
    ProgramDayDto? Day, ProgramDayDto? Next,
    TrainingSessionSummaryDto? ActiveSession = null,
    IReadOnlyList<TrainingSessionSummaryDto>? CompletedToday = null);

public record ExerciseAlternativesDto(Guid ExerciseId, string Direction, string Location,
    IReadOnlyList<ExerciseListItemDto> Items);

// ---- training: live workout sessions & personal records (P4) ----

public record TrainingSessionSummaryDto(
    Guid Id, Guid? ProgramId, Guid? ProgramDayId, string Name, string Kind, DateOnly Date,
    DateTimeOffset StartedAt, DateTimeOffset? FinishedAt, int? DurationMinutes, int? EstimatedKcal,
    int ExerciseCount, int TotalSets, int CompletedSets, decimal TotalVolumeKg, int PrCount,
    string Notes, Guid? WorkoutId);

public record SessionSetDto(
    Guid Id, int SetNumber, int? TargetRepsMin, int? TargetRepsMax, int? TargetSeconds,
    decimal? TargetKg, int RestSeconds, int? Reps, int? Seconds, decimal? WeightKg,
    bool Completed, DateTimeOffset? CompletedAt, string Notes, bool IsPr);

public record LastSetSnapshotDto(decimal? WeightKg, int? Reps, int? Seconds);

public record ExerciseLastPerformanceDto(DateOnly Date, IReadOnlyList<LastSetSnapshotDto> Sets);

public record ExercisePrBaselineDto(
    decimal? BestWeightKg, int? BestWeightReps, decimal? BestEst1RmKg,
    int? BestBodyweightReps, int? BestSeconds);

public record SessionExerciseGroupDto(
    int Order, Guid ExerciseId, string Name, string NameEn, string Equipment,
    IReadOnlyList<string> PrimaryMuscles, bool IsTimed, bool HasVideo, string? ThumbnailUrl,
    int RestSeconds, string? SupersetGroup,
    ExerciseLastPerformanceDto? LastPerformance,
    ExercisePrBaselineDto? PrBaseline,
    IReadOnlyList<SessionSetDto> Sets);

public record TrainingSessionDetailDto(
    Guid Id, Guid? ProgramId, Guid? ProgramDayId, string Name, string Kind, DateOnly Date,
    DateTimeOffset StartedAt, DateTimeOffset? FinishedAt, int? DurationMinutes, int? EstimatedKcal,
    string Notes, Guid? WorkoutId, bool HasFutureProgramWeeks,
    int CompletedSets, int TotalSets, decimal TotalVolumeKg, int PrCount,
    IReadOnlyList<SessionExerciseGroupDto> Exercises);

public record StartSessionInput(
    Guid? ProgramDayId, string? Name, DateOnly? Date, List<Guid>? ExerciseIds,
    bool? CompleteNow, int? DurationMinutes, int? EstimatedKcal, string? Notes);

public record PatchSessionInput(string? Name, string? Notes);

public record PatchSessionSetInput(
    decimal? WeightKg, bool? ClearWeight,
    int? Reps, bool? ClearReps,
    int? Seconds, bool? ClearSeconds,
    bool? Completed, string? Notes);

public record AddSessionSetInput(
    Guid ExerciseId, int? ExerciseOrder, decimal? WeightKg, int? Reps, int? Seconds, int? RestSeconds);

public record FinishSessionInput(
    int? DurationMinutes, int? EstimatedKcal, bool? ClearEstimatedKcal,
    string? Notes, bool? UpdateFutureTargets, bool? LogActivity);

public record SessionNewPrDto(
    Guid ExerciseId, string ExerciseName, string Metric,
    decimal? WeightKg, int? Reps, int? Seconds, decimal? Est1RmKg,
    decimal? PreviousValue, decimal NewValue);

public record FinishSessionResultDto(
    TrainingSessionDetailDto Session,
    IReadOnlyList<SessionNewPrDto> NewPrs,
    decimal TotalVolumeKg,
    int CompletedSets,
    int UpdatedFutureTargets,
    bool ActivityLinked,
    bool DedupedWithWatch);

public record ExercisePrDto(
    Guid ExerciseId, string Name, string NameEn, string Equipment,
    IReadOnlyList<string> PrimaryMuscles, bool IsTimed, string? ThumbnailUrl,
    decimal? BestWeightKg, int? BestWeightReps, DateOnly? BestWeightDate,
    decimal? BestEst1RmKg, DateOnly? BestEst1RmDate,
    int? BestBodyweightReps, DateOnly? BestBodyweightRepsDate,
    int? BestSeconds, DateOnly? BestSecondsDate,
    int TotalSessions, int TotalCompletedSets, DateOnly LastPerformedDate);
