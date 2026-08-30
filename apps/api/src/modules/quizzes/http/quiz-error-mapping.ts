import { HttpStatus } from '@nestjs/common';
import { QuizError, type QuizErrorCode } from '../errors/quiz.errors';

const ERROR_STATUS: Record<QuizErrorCode, HttpStatus> = {
  QUIZ_NOT_FOUND: HttpStatus.NOT_FOUND,
  QUESTION_NOT_FOUND: HttpStatus.NOT_FOUND,
  QUESTION_OPTION_NOT_FOUND: HttpStatus.NOT_FOUND,
  QUESTION_POSITION_CONFLICT: HttpStatus.CONFLICT,
  QUESTION_OPTION_POSITION_CONFLICT: HttpStatus.CONFLICT,
  INVALID_QUESTION_REORDER: HttpStatus.BAD_REQUEST,
  INVALID_QUESTION_OPTION_REORDER: HttpStatus.BAD_REQUEST,
  QUESTION_OPTION_LIMIT_EXCEEDED: HttpStatus.BAD_REQUEST,
  MULTIPLE_CORRECT_OPTIONS_NOT_ALLOWED: HttpStatus.BAD_REQUEST,
};

const ERROR_MESSAGES: Record<QuizErrorCode, string> = {
  QUIZ_NOT_FOUND: 'Quiz was not found.',
  QUESTION_NOT_FOUND: 'Question was not found.',
  QUESTION_OPTION_NOT_FOUND: 'Question option was not found.',
  QUESTION_POSITION_CONFLICT: 'Question position conflict; retry the request.',
  QUESTION_OPTION_POSITION_CONFLICT: 'Question option position conflict; retry the request.',
  INVALID_QUESTION_REORDER: 'Reorder payload must contain exactly the current active questions for this quiz.',
  INVALID_QUESTION_OPTION_REORDER: 'Reorder payload must contain exactly the current options for this question.',
  QUESTION_OPTION_LIMIT_EXCEEDED: 'This question type does not allow additional options.',
  MULTIPLE_CORRECT_OPTIONS_NOT_ALLOWED: 'Only one option may be marked correct for this question.',
};

type ErrorResponseBody = {
  error: {
    code: string;
    message: string;
  };
};

export function mapQuizErrorToHttp(error: QuizError): {
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
