import { HttpStatus } from '@nestjs/common';
import { CourseError, type CourseErrorCode } from '../errors/course.errors';

const ERROR_STATUS: Record<CourseErrorCode, HttpStatus> = {
  COURSE_NOT_FOUND: HttpStatus.NOT_FOUND,
};

const ERROR_MESSAGES: Record<CourseErrorCode, string> = {
  COURSE_NOT_FOUND: 'Course was not found.',
};

type ErrorResponseBody = {
  error: {
    code: string;
    message: string;
  };
};

export function mapCourseErrorToHttp(error: CourseError): {
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
