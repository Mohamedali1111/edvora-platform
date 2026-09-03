import { HttpStatus } from '@nestjs/common';
import { CourseError, PublishSelectionStaleError, type CourseErrorCode } from '../errors/course.errors';
import type { ReadinessIssue } from '../types/course-readiness.types';

const ERROR_STATUS: Record<CourseErrorCode, HttpStatus> = {
  COURSE_NOT_FOUND: HttpStatus.NOT_FOUND,
  SECTION_NOT_FOUND: HttpStatus.NOT_FOUND,
  LESSON_NOT_FOUND: HttpStatus.NOT_FOUND,
  SECTION_POSITION_CONFLICT: HttpStatus.CONFLICT,
  LESSON_POSITION_CONFLICT: HttpStatus.CONFLICT,
  INVALID_COURSE_LIFECYCLE_TRANSITION: HttpStatus.CONFLICT,
  INVALID_SECTION_LIFECYCLE_TRANSITION: HttpStatus.CONFLICT,
  INVALID_LESSON_LIFECYCLE_TRANSITION: HttpStatus.CONFLICT,
  LESSON_CONTENT_NOT_READY: HttpStatus.CONFLICT,
  INVALID_SECTION_REORDER: HttpStatus.BAD_REQUEST,
  INVALID_LESSON_REORDER: HttpStatus.BAD_REQUEST,
  INVALID_LESSON_TYPE_REFERENCE: HttpStatus.BAD_REQUEST,
  LESSON_REFERENCE_NOT_FOUND: HttpStatus.NOT_FOUND,
  QUIZ_LESSON_COMPLETION_NOT_ALLOWED: HttpStatus.BAD_REQUEST,
  COURSE_DATA_INTEGRITY_VIOLATION: HttpStatus.INTERNAL_SERVER_ERROR,
  COURSE_ALREADY_PUBLISHED_ONCE: HttpStatus.CONFLICT,
  PUBLISH_SELECTION_STALE: HttpStatus.CONFLICT,
};

const ERROR_MESSAGES: Record<CourseErrorCode, string> = {
  COURSE_NOT_FOUND: 'Course was not found.',
  SECTION_NOT_FOUND: 'Course section was not found.',
  LESSON_NOT_FOUND: 'Lesson was not found.',
  SECTION_POSITION_CONFLICT: 'Section position conflict; retry the request.',
  LESSON_POSITION_CONFLICT: 'Lesson position conflict; retry the request.',
  INVALID_COURSE_LIFECYCLE_TRANSITION: 'Course lifecycle transition is not allowed.',
  INVALID_SECTION_LIFECYCLE_TRANSITION: 'Course section lifecycle transition is not allowed.',
  INVALID_LESSON_LIFECYCLE_TRANSITION: 'Lesson lifecycle transition is not allowed.',
  LESSON_CONTENT_NOT_READY: 'Lesson content is not ready to publish.',
  INVALID_SECTION_REORDER: 'Reorder payload must contain exactly the current active sections for this course.',
  INVALID_LESSON_REORDER: 'Reorder payload must contain exactly the current active lessons for this section.',
  INVALID_LESSON_TYPE_REFERENCE: 'Lesson type reference does not match the declared lesson type.',
  LESSON_REFERENCE_NOT_FOUND: 'Referenced video asset, document asset, or quiz was not found.',
  QUIZ_LESSON_COMPLETION_NOT_ALLOWED: 'Quiz lessons cannot be manually marked completed.',
  COURSE_DATA_INTEGRITY_VIOLATION: 'Course content data is in an unexpected, inconsistent state.',
  COURSE_ALREADY_PUBLISHED_ONCE: 'Course has already been published once; use the granular publish endpoint instead.',
  PUBLISH_SELECTION_STALE: 'The reviewed publish selection is no longer valid; re-check readiness and try again.',
};

type ErrorResponseBody = {
  error: {
    code: string;
    message: string;
    // Present only for PUBLISH_SELECTION_STALE — the reviewed selection's current, machine-readable
    // blockers, in the exact `ReadinessIssue` shape `GET .../readiness` already returns. Every other
    // Course error keeps the plain, unchanged `{ code, message }` envelope.
    blockers?: readonly ReadinessIssue[];
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
        ...(error instanceof PublishSelectionStaleError ? { blockers: error.blockers } : {}),
      },
    },
  };
}
