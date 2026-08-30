import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  ArrayUnique,
  IsEnum,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { QuestionType } from '../../../../.generated/prisma/client';
import { UUID_PARAM_PATTERN } from '../../tenancy/dto/uuid-param.dto';

export class CreateQuestionDto {
  @IsEnum(QuestionType)
  type!: QuestionType;

  @Transform(({ value }) => trimString(value))
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  prompt!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  points!: number;
}

export class UpdateQuestionMetadataDto {
  @Transform(({ value }) => trimOptionalNonNullableString(value))
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  prompt?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  points?: number;
}

export class ReorderQuestionsDto {
  @ArrayNotEmpty()
  @ArrayMaxSize(500)
  @ArrayUnique()
  @Matches(UUID_PARAM_PATTERN, { each: true })
  questionIds!: string[];
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
