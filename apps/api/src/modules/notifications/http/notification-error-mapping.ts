import { HttpStatus } from '@nestjs/common';
import { NotificationError, type NotificationErrorCode } from '../errors/notification.errors';

const ERROR_STATUS: Record<NotificationErrorCode, HttpStatus> = {
  STUDENT_REQUIRED: HttpStatus.FORBIDDEN,
  INSTRUCTOR_REQUIRED: HttpStatus.FORBIDDEN,
  NOTIFICATION_NOT_FOUND: HttpStatus.NOT_FOUND,
};

const ERROR_MESSAGES: Record<NotificationErrorCode, string> = {
  STUDENT_REQUIRED: 'Student access is required.',
  INSTRUCTOR_REQUIRED: 'Instructor access is required.',
  NOTIFICATION_NOT_FOUND: 'Notification was not found.',
};

type ErrorResponseBody = {
  error: {
    code: string;
    message: string;
  };
};

export function mapNotificationErrorToHttp(error: NotificationError): {
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
