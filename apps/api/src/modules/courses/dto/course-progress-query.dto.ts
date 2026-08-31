import { IsEnum, IsOptional } from 'class-validator';
import { EnrollmentStatus } from '../../../../.generated/prisma/client';
import { PaginationQueryDto } from '../../tenancy/dto/pagination-query.dto';

export class CourseProgressQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(EnrollmentStatus)
  status?: EnrollmentStatus;
}
