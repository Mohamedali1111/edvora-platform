import { Matches } from 'class-validator';

export const UUID_PARAM_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;

export class TenantIdParamDto {
  @Matches(UUID_PARAM_PATTERN)
  tenantId!: string;
}

export class InstructorIdParamDto {
  @Matches(UUID_PARAM_PATTERN)
  instructorId!: string;
}

export class TenantStudentParamDto extends TenantIdParamDto {
  @Matches(UUID_PARAM_PATTERN)
  studentUserId!: string;
}

export class EnrollmentIdParamDto extends TenantIdParamDto {
  @Matches(UUID_PARAM_PATTERN)
  enrollmentId!: string;
}
