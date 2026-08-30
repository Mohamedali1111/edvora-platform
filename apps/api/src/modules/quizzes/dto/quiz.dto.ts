import { Transform } from 'class-transformer';
import { IsEnum, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { QuizRevealAnswersPolicy } from '../../../../.generated/prisma/client';

export class CreateQuizDto {
  @Transform(({ value }) => trimString(value))
  @IsString()
  @MinLength(1)
  @MaxLength(240)
  title!: string;

  @Transform(({ value }) => trimNullableString(value))
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  passingScorePercent?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  attemptLimit?: number;

  @IsOptional()
  @IsEnum(QuizRevealAnswersPolicy)
  revealAnswersPolicy?: QuizRevealAnswersPolicy;
}

export class UpdateQuizMetadataDto {
  // `title` is NOT NULL in the schema, so a whitespace-only value is normalized to `undefined`
  // (left unchanged) rather than `null` — sending `null` here would just fail as a raw DB
  // constraint violation instead of a clean validation error.
  @Transform(({ value }) => trimOptionalNonNullableString(value))
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(240)
  title?: string;

  // `description` is nullable, so a whitespace-only value explicitly clears it.
  @Transform(({ value }) => trimNullableString(value))
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  passingScorePercent?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  attemptLimit?: number | null;

  @IsOptional()
  @IsEnum(QuizRevealAnswersPolicy)
  revealAnswersPolicy?: QuizRevealAnswersPolicy;
}

function trimString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

function trimOptionalNonNullableString(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function trimNullableString(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}
