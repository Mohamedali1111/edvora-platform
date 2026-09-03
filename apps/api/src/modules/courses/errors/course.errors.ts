import type { ReadinessIssue } from '../types/course-readiness.types';

export type CourseErrorCode =
  | 'COURSE_NOT_FOUND'
  | 'SECTION_NOT_FOUND'
  | 'LESSON_NOT_FOUND'
  | 'SECTION_POSITION_CONFLICT'
  | 'LESSON_POSITION_CONFLICT'
  | 'INVALID_COURSE_LIFECYCLE_TRANSITION'
  | 'INVALID_SECTION_LIFECYCLE_TRANSITION'
  | 'INVALID_LESSON_LIFECYCLE_TRANSITION'
  | 'LESSON_CONTENT_NOT_READY'
  | 'INVALID_SECTION_REORDER'
  | 'INVALID_LESSON_REORDER'
  | 'INVALID_LESSON_TYPE_REFERENCE'
  | 'LESSON_REFERENCE_NOT_FOUND'
  | 'QUIZ_LESSON_COMPLETION_NOT_ALLOWED'
  | 'COURSE_DATA_INTEGRITY_VIOLATION'
  | 'COURSE_ALREADY_PUBLISHED_ONCE'
  | 'PUBLISH_SELECTION_STALE';

export class CourseError extends Error {
  constructor(
    readonly code: CourseErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CourseError';
  }
}

export class CourseNotFoundError extends CourseError {
  constructor() {
    super('COURSE_NOT_FOUND', 'Course was not found.');
  }
}

export class SectionNotFoundError extends CourseError {
  constructor() {
    super('SECTION_NOT_FOUND', 'Course section was not found.');
  }
}

export class LessonNotFoundError extends CourseError {
  constructor() {
    super('LESSON_NOT_FOUND', 'Lesson was not found.');
  }
}

export class SectionPositionConflictError extends CourseError {
  constructor() {
    super('SECTION_POSITION_CONFLICT', 'Section position conflict; retry the request.');
  }
}

export class LessonPositionConflictError extends CourseError {
  constructor() {
    super('LESSON_POSITION_CONFLICT', 'Lesson position conflict; retry the request.');
  }
}

export class InvalidCourseLifecycleTransitionError extends CourseError {
  constructor() {
    super('INVALID_COURSE_LIFECYCLE_TRANSITION', 'Course lifecycle transition is not allowed.');
  }
}

export class InvalidSectionLifecycleTransitionError extends CourseError {
  constructor() {
    super('INVALID_SECTION_LIFECYCLE_TRANSITION', 'Course section lifecycle transition is not allowed.');
  }
}

export class InvalidLessonLifecycleTransitionError extends CourseError {
  constructor() {
    super('INVALID_LESSON_LIFECYCLE_TRANSITION', 'Lesson lifecycle transition is not allowed.');
  }
}

export class LessonContentNotReadyError extends CourseError {
  constructor() {
    super('LESSON_CONTENT_NOT_READY', 'Lesson content is not ready to publish.');
  }
}

export class InvalidSectionReorderError extends CourseError {
  constructor() {
    super(
      'INVALID_SECTION_REORDER',
      'Reorder payload must contain exactly the current active sections for this course.',
    );
  }
}

export class InvalidLessonReorderError extends CourseError {
  constructor() {
    super(
      'INVALID_LESSON_REORDER',
      'Reorder payload must contain exactly the current active lessons for this section.',
    );
  }
}

export class InvalidLessonTypeReferenceError extends CourseError {
  constructor() {
    super(
      'INVALID_LESSON_TYPE_REFERENCE',
      'Lesson type reference does not match the declared lesson type.',
    );
  }
}

export class LessonReferenceNotFoundError extends CourseError {
  constructor() {
    super(
      'LESSON_REFERENCE_NOT_FOUND',
      'Referenced video asset, document asset, or quiz was not found.',
    );
  }
}

export class QuizLessonCompletionNotAllowedError extends CourseError {
  constructor() {
    super(
      'QUIZ_LESSON_COMPLETION_NOT_ALLOWED',
      'Quiz lessons cannot be manually marked completed.',
    );
  }
}

// Reached only when a Lesson's declared `type` has no matching VideoLesson/DocumentLesson/QuizLesson
// detail row — provably impossible through this API (`LessonService.createLesson` writes the Lesson
// and its one type-matching detail row atomically in the same transaction, see
// `assertSingleTypeReference`), so this signals genuine underlying data corruption, not a normal
// user-facing readiness gap. Course Readiness must fail loudly here rather than silently reporting a
// corrupted Lesson as ready or simply omitting it — see `evaluateCourseReadiness`.
export class CourseDataIntegrityError extends CourseError {
  constructor() {
    super(
      'COURSE_DATA_INTEGRITY_VIOLATION',
      'Course content data is in an unexpected, inconsistent state.',
    );
  }
}

// `POST .../courses/:courseId/publish-selected` is first-publish-only. `Course.publishedAt` is set
// exactly once, the very first time a Course transitions DRAFT -> PUBLISHED (via the existing granular
// `publishCourse()`), and is never cleared again by Take Offline (`unpublishCourse`) or Restore
// (`restoreCourse`) — see `CoursePublishSelectedService`'s doc comment for the full review of every
// mutation path. So `publishedAt !== null` is a safe, permanent "has been published before" signal,
// even though a *republish* through the granular `/publish` endpoint after Take Offline does overwrite
// `publishedAt` with a fresh timestamp. A Course in that state must use the existing granular
// `/publish` endpoint ("make live again"), never this one.
export class CourseAlreadyPublishedOnceError extends CourseError {
  constructor() {
    super(
      'COURSE_ALREADY_PUBLISHED_ONCE',
      'Course has already been published once; use the granular publish endpoint instead.',
    );
  }
}

// The Instructor reviewed one exact Section/Lesson/Quiz selection (from a prior `GET .../readiness`
// call) and submitted it for first publication. This is thrown when ANY submitted item is no longer a
// valid publish target by the time the mutation actually runs inside its transaction — already
// PUBLISHED/ARCHIVED, content that regressed since review, a Draft Quiz that became unpublishable, or
// a structural-invariant violation (see `evaluateStructuralSelectionBlockers`). The whole selection is
// rejected atomically; nothing is published. `blockers` reuses the exact `ReadinessIssue` shape/reason
// codes `GET .../readiness` already returns (see `course-readiness.types.ts`) rather than a second,
// divergent taxonomy, and is carried through `mapCourseErrorToHttp` as an additional `blockers` field
// on the standard `{ error: { code, message } }` envelope — see `course-error-mapping.ts`.
export class PublishSelectionStaleError extends CourseError {
  constructor(readonly blockers: readonly ReadinessIssue[]) {
    super(
      'PUBLISH_SELECTION_STALE',
      'The reviewed publish selection is no longer valid; re-check readiness and try again.',
    );
  }
}
