import { IsEnum, IsOptional, Matches } from 'class-validator';
import { EnrollmentStatus } from '../../../../.generated/prisma/client';
import { PaginationQueryDto } from './pagination-query.dto';
import { UUID_PARAM_PATTERN } from './uuid-param.dto';

// Deliberately one flat, filterable list rather than two nested route families
// (`.../courses/:courseId/enrollments` and `.../students/:studentUserId/enrollments`): the
// existing Enrollment routes (`POST /instructor/tenants/:tenantId/enrollments`,
// `POST .../:enrollmentId/revoke`) are already flat, not nested under Course or Student, so a
// filtered `GET` on the same base path is the smaller, more consistent addition. At least one of
// `courseId`/`studentUserId` is required by the service (not here — `EnrollmentQueryFilterRequiredError`
// is a clean domain error, not a raw DTO validation failure), keeping this endpoint scoped to the
// two concrete "course roster" / "student enrollment history" reads it exists for, not a
// general-purpose enrollment search.
export class ListEnrollmentsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @Matches(UUID_PARAM_PATTERN)
  courseId?: string;

  @IsOptional()
  @Matches(UUID_PARAM_PATTERN)
  studentUserId?: string;

  @IsOptional()
  @IsEnum(EnrollmentStatus)
  status?: EnrollmentStatus;
}
