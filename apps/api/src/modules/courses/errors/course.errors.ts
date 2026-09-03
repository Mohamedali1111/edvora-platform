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
  | 'COURSE_DATA_INTEGRITY_VIOLATION';

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
