import { Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayNotEmpty, ArrayUnique, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { UUID_PARAM_PATTERN } from '../../tenancy/dto/uuid-param.dto';

export class CreateSectionDto {
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
}

export class UpdateSectionMetadataDto {
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
}

export class ReorderSectionsDto {
  @ArrayNotEmpty()
  @ArrayMaxSize(500)
  @ArrayUnique()
  @Matches(UUID_PARAM_PATTERN, { each: true })
  sectionIds!: string[];
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
