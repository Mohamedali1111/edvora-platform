import { HttpStatus } from '@nestjs/common';
import { TenancyError, type TenancyErrorCode } from '../errors/tenancy.errors';

const ERROR_STATUS: Record<TenancyErrorCode, HttpStatus> = {
  PLATFORM_ADMIN_REQUIRED: HttpStatus.FORBIDDEN,
  INSTRUCTOR_REQUIRED: HttpStatus.FORBIDDEN,
  STUDENT_REQUIRED: HttpStatus.FORBIDDEN,
  TENANT_ACCESS_DENIED: HttpStatus.FORBIDDEN,
  IDENTITY_ROLE_CONFLICT: HttpStatus.CONFLICT,
  INSTRUCTOR_ALREADY_EXISTS: HttpStatus.CONFLICT,
  INSTRUCTOR_NOT_FOUND: HttpStatus.NOT_FOUND,
  TENANT_SLUG_ALREADY_EXISTS: HttpStatus.CONFLICT,
  TENANT_STUDENT_NOT_FOUND: HttpStatus.NOT_FOUND,
  ENROLLMENT_NOT_FOUND: HttpStatus.NOT_FOUND,
  ENROLLMENT_ALREADY_ACTIVE: HttpStatus.CONFLICT,
  ENROLLMENT_QUERY_FILTER_REQUIRED: HttpStatus.BAD_REQUEST,
  COURSE_NOT_FOUND: HttpStatus.NOT_FOUND,
};

const ERROR_MESSAGES: Record<TenancyErrorCode, string> = {
  PLATFORM_ADMIN_REQUIRED: 'Platform administrator access is required.',
  INSTRUCTOR_REQUIRED: 'Instructor access is required.',
  STUDENT_REQUIRED: 'Student access is required.',
  TENANT_ACCESS_DENIED: 'Tenant access is denied.',
  IDENTITY_ROLE_CONFLICT: 'Email already belongs to a different account role.',
  INSTRUCTOR_ALREADY_EXISTS: 'Instructor identity already exists.',
  INSTRUCTOR_NOT_FOUND: 'Instructor was not found.',
  TENANT_SLUG_ALREADY_EXISTS: 'Tenant slug already exists.',
  TENANT_STUDENT_NOT_FOUND: 'Student was not found for this tenant.',
  ENROLLMENT_NOT_FOUND: 'Enrollment was not found.',
  ENROLLMENT_ALREADY_ACTIVE: 'Student already has an active enrollment for this course.',
  ENROLLMENT_QUERY_FILTER_REQUIRED: 'Provide a courseId or studentUserId filter to list enrollments.',
  COURSE_NOT_FOUND: 'Course was not found.',
};

type ErrorResponseBody = {
  error: {
    code: string;
    message: string;
  };
};

export function mapTenancyErrorToHttp(error: TenancyError): {
  status: HttpStatus;
  body: ErrorResponseBody;
} {
  return {
    status: ERROR_STATUS[error.code],
    body: {
      error: {
        code: error.code,
        message: ERROR_MESSAGES[error.code],
      },
    },
  };
}
