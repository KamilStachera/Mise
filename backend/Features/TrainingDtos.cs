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
