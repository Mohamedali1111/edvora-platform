import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  ArrayUnique,
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
// Note: videoAssetId/documentAssetId/quizId are `@IsOptional()` in addition to `@ValidateIf`.
// `@IsOptional()` skips format validation entirely when the field is missing, regardless of
// `type` — so a missing-for-the-declared-type reference is never rejected here as a generic
// `VALIDATION_FAILED`. That case, and any mismatched/extra reference, is instead caught
// consistently by the service's `assertSingleTypeReference` check (INVALID_LESSON_TYPE_REFERENCE).
// A *present but malformed* reference (wrong UUID shape) is still rejected here.
import { LessonType } from '../../../../.generated/prisma/client';
import { UUID_PARAM_PATTERN } from '../../tenancy/dto/uuid-param.dto';

export class CreateLessonDto {
  @Transform(({ value }) => trimString(value))
  @IsString()
  @MinLength(1)
  @MaxLength(240)
  title!: string;

  @Transform(({ value }) => trimOptionalString(value))
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsEnum(LessonType)
  type!: LessonType;

  @IsOptional()
  @ValidateIf((dto: CreateLessonDto) => dto.type === LessonType.VIDEO)
  @Matches(UUID_PARAM_PATTERN)
  videoAssetId?: string;

  @IsOptional()
  @ValidateIf((dto: CreateLessonDto) => dto.type === LessonType.DOCUMENT)
  @Matches(UUID_PARAM_PATTERN)
  documentAssetId?: string;

  @IsOptional()
  @ValidateIf((dto: CreateLessonDto) => dto.type === LessonType.QUIZ)
  @Matches(UUID_PARAM_PATTERN)
  quizId?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  availableFrom?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  availableUntil?: string;
}

export class UpdateLessonMetadataDto {
  @Transform(({ value }) => trimOptionalString(value))
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(240)
  title?: string;

  @Transform(({ value }) => trimOptionalString(value))
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string | null;

  @IsOptional()
  @IsISO8601({ strict: true })
  availableFrom?: string | null;

  @IsOptional()
  @IsISO8601({ strict: true })
  availableUntil?: string | null;
}

export class ReorderLessonsDto {
  @ArrayNotEmpty()
  @ArrayMaxSize(500)
  @ArrayUnique()
  @Matches(UUID_PARAM_PATTERN, { each: true })
  lessonIds!: string[];
}

function trimString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

function trimOptionalString(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}
