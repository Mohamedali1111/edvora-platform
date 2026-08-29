import { IsISO8601, IsOptional, Matches } from 'class-validator';
import { UUID_PARAM_PATTERN } from './uuid-param.dto';

export class CreateEnrollmentDto {
  @Matches(UUID_PARAM_PATTERN)
  studentUserId!: string;

  @Matches(UUID_PARAM_PATTERN)
  courseId!: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  startsAt?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  endsAt?: string;
}
