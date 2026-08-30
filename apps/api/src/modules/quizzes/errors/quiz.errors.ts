export type QuizErrorCode =
  | 'QUIZ_NOT_FOUND'
  | 'QUESTION_NOT_FOUND'
  | 'QUESTION_OPTION_NOT_FOUND'
  | 'QUESTION_POSITION_CONFLICT'
  | 'QUESTION_OPTION_POSITION_CONFLICT'
  | 'INVALID_QUESTION_REORDER'
  | 'INVALID_QUESTION_OPTION_REORDER'
  | 'QUESTION_OPTION_LIMIT_EXCEEDED'
  | 'MULTIPLE_CORRECT_OPTIONS_NOT_ALLOWED';

export class QuizError extends Error {
  constructor(
    readonly code: QuizErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'QuizError';
  }
}

export class QuizNotFoundError extends QuizError {
  constructor() {
    super('QUIZ_NOT_FOUND', 'Quiz was not found.');
  }
}

export class QuestionNotFoundError extends QuizError {
  constructor() {
    super('QUESTION_NOT_FOUND', 'Question was not found.');
  }
}

export class QuestionOptionNotFoundError extends QuizError {
  constructor() {
    super('QUESTION_OPTION_NOT_FOUND', 'Question option was not found.');
  }
}

export class QuestionPositionConflictError extends QuizError {
  constructor() {
    super('QUESTION_POSITION_CONFLICT', 'Question position conflict; retry the request.');
  }
}

export class QuestionOptionPositionConflictError extends QuizError {
  constructor() {
    super('QUESTION_OPTION_POSITION_CONFLICT', 'Question option position conflict; retry the request.');
  }
}

export class InvalidQuestionReorderError extends QuizError {
  constructor() {
    super(
      'INVALID_QUESTION_REORDER',
      'Reorder payload must contain exactly the current active questions for this quiz.',
    );
  }
}

export class InvalidQuestionOptionReorderError extends QuizError {
  constructor() {
    super(
      'INVALID_QUESTION_OPTION_REORDER',
      'Reorder payload must contain exactly the current options for this question.',
    );
  }
}

export class QuestionOptionLimitExceededError extends QuizError {
  constructor() {
    super('QUESTION_OPTION_LIMIT_EXCEEDED', 'This question type does not allow additional options.');
  }
}

export class MultipleCorrectOptionsNotAllowedError extends QuizError {
  constructor() {
    super('MULTIPLE_CORRECT_OPTIONS_NOT_ALLOWED', 'Only one option may be marked correct for this question.');
  }
}
