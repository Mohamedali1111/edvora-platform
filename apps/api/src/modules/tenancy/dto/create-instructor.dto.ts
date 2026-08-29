import { IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateInstructorDto {
  @Transform(({ value }) => trimString(value))
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  displayName?: string;

  @Transform(({ value }) => trimString(value))
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  tenantName!: string;

  @Transform(({ value }) => trimAndLowerString(value))
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  tenantSlug!: string;
}

function trimString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

function trimAndLowerString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim().toLowerCase() : value;
}
