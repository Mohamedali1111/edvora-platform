export type NotificationErrorCode =
  | 'STUDENT_REQUIRED'
  | 'INSTRUCTOR_REQUIRED'
  | 'NOTIFICATION_NOT_FOUND';

export class NotificationError extends Error {
  constructor(
    readonly code: NotificationErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export class StudentRequiredError extends NotificationError {
  constructor() {
    super('STUDENT_REQUIRED', 'Current active student is required.');
  }
}

export class InstructorRequiredError extends NotificationError {
  constructor() {
    super('INSTRUCTOR_REQUIRED', 'Current active instructor is required.');
  }
}

export class NotificationNotFoundError extends NotificationError {
  constructor() {
    super('NOTIFICATION_NOT_FOUND', 'Notification was not found.');
  }
}
