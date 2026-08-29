export type CourseErrorCode = 'COURSE_NOT_FOUND';

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
