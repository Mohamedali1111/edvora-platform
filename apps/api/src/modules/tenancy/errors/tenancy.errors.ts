export type TenancyErrorCode =
  | 'PLATFORM_ADMIN_REQUIRED'
  | 'INSTRUCTOR_REQUIRED'
  | 'STUDENT_REQUIRED'
  | 'TENANT_ACCESS_DENIED'
  | 'IDENTITY_ROLE_CONFLICT'
  | 'INSTRUCTOR_ALREADY_EXISTS'
  | 'INSTRUCTOR_NOT_FOUND'
  | 'TENANT_SLUG_ALREADY_EXISTS'
  | 'TENANT_STUDENT_NOT_FOUND'
  | 'ENROLLMENT_NOT_FOUND'
  | 'ENROLLMENT_ALREADY_ACTIVE'
  | 'COURSE_NOT_FOUND';

export class TenancyError extends Error {
  constructor(
    readonly code: TenancyErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'TenancyError';
  }
}

export class PlatformAdminRequiredError extends TenancyError {
  constructor() {
    super('PLATFORM_ADMIN_REQUIRED', 'Current active platform administrator is required.');
  }
}

export class InstructorRequiredError extends TenancyError {
  constructor() {
    super('INSTRUCTOR_REQUIRED', 'Current active instructor is required.');
  }
}

export class StudentRequiredError extends TenancyError {
  constructor() {
    super('STUDENT_REQUIRED', 'Current active student is required.');
  }
}

export class TenantAccessDeniedError extends TenancyError {
  constructor() {
    super('TENANT_ACCESS_DENIED', 'Tenant access is denied.');
  }
}

export class IdentityRoleConflictError extends TenancyError {
  constructor() {
    super('IDENTITY_ROLE_CONFLICT', 'Email already belongs to a different account role.');
  }
}

export class InstructorAlreadyExistsError extends TenancyError {
  constructor() {
    super('INSTRUCTOR_ALREADY_EXISTS', 'Instructor identity already exists.');
  }
}

export class InstructorNotFoundError extends TenancyError {
  constructor() {
    super('INSTRUCTOR_NOT_FOUND', 'Instructor was not found.');
  }
}

export class TenantSlugAlreadyExistsError extends TenancyError {
  constructor() {
    super('TENANT_SLUG_ALREADY_EXISTS', 'Tenant slug already exists.');
  }
}

export class TenantStudentNotFoundError extends TenancyError {
  constructor() {
    super('TENANT_STUDENT_NOT_FOUND', 'Tenant student was not found.');
  }
}

export class EnrollmentNotFoundError extends TenancyError {
  constructor() {
    super('ENROLLMENT_NOT_FOUND', 'Enrollment was not found.');
  }
}

export class EnrollmentAlreadyActiveError extends TenancyError {
  constructor() {
    super('ENROLLMENT_ALREADY_ACTIVE', 'Student already has an active enrollment for this course.');
  }
}

export class CourseNotFoundError extends TenancyError {
  constructor() {
    super('COURSE_NOT_FOUND', 'Course was not found.');
  }
}
