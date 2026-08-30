export type CourseErrorCode =
  | 'COURSE_NOT_FOUND'
  | 'SECTION_NOT_FOUND'
  | 'LESSON_NOT_FOUND'
  | 'SECTION_POSITION_CONFLICT'
  | 'LESSON_POSITION_CONFLICT'
  | 'INVALID_SECTION_REORDER'
  | 'INVALID_LESSON_REORDER'
  | 'INVALID_LESSON_TYPE_REFERENCE'
  | 'LESSON_REFERENCE_NOT_FOUND'
  | 'QUIZ_LESSON_COMPLETION_NOT_ALLOWED';

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
