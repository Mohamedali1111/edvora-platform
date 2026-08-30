import { Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayNotEmpty, ArrayUnique, IsBoolean, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { UUID_PARAM_PATTERN } from '../../tenancy/dto/uuid-param.dto';

export class CreateQuestionOptionDto {
  @Transform(({ value }) => trimNullableString(value))
  @IsOptional()
  @IsString()
  @MaxLength(40)
  label?: string;

  @Transform(({ value }) => trimString(value))
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  text!: string;

  @IsOptional()
  @IsBoolean()
  isCorrect?: boolean;
}

export class UpdateQuestionOptionDto {
  @Transform(({ value }) => trimNullableString(value))
  @IsOptional()
  @IsString()
  @MaxLength(40)
  label?: string | null;

  // `text` is NOT NULL in the schema, so a whitespace-only value is normalized to `undefined`
  // (left unchanged) rather than `null`.
  @Transform(({ value }) => trimOptionalNonNullableString(value))
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  text?: string;

  @IsOptional()
  @IsBoolean()
  isCorrect?: boolean;
}

export class ReorderQuestionOptionsDto {
  @ArrayNotEmpty()
  @ArrayMaxSize(500)
  @ArrayUnique()
  @Matches(UUID_PARAM_PATTERN, { each: true })
  optionIds!: string[];
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
