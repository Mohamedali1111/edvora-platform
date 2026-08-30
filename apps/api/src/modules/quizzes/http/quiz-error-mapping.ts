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
  QUIZ_ATTEMPT_NOT_FOUND: HttpStatus.NOT_FOUND,
  QUIZ_ATTEMPT_NOT_OPEN: HttpStatus.CONFLICT,
  QUIZ_HAS_NO_ACTIVE_QUESTIONS: HttpStatus.CONFLICT,
  QUIZ_ATTEMPT_LIMIT_REACHED: HttpStatus.CONFLICT,
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
  QUIZ_ATTEMPT_NOT_FOUND: 'Quiz attempt was not found.',
  QUIZ_ATTEMPT_NOT_OPEN: 'This quiz attempt is already finalized and can no longer be modified.',
  QUIZ_HAS_NO_ACTIVE_QUESTIONS: 'This quiz currently has no active questions to attempt.',
  QUIZ_ATTEMPT_LIMIT_REACHED: 'The maximum number of attempts for this quiz has already been used.',
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
