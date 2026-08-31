export type QuizErrorCode =
  | 'QUIZ_NOT_FOUND'
  | 'QUESTION_NOT_FOUND'
  | 'QUESTION_OPTION_NOT_FOUND'
  | 'QUESTION_POSITION_CONFLICT'
  | 'QUESTION_OPTION_POSITION_CONFLICT'
  | 'INVALID_QUESTION_REORDER'
  | 'INVALID_QUESTION_OPTION_REORDER'
  | 'QUESTION_OPTION_LIMIT_EXCEEDED'
  | 'MULTIPLE_CORRECT_OPTIONS_NOT_ALLOWED'
  | 'QUIZ_ATTEMPT_NOT_FOUND'
  | 'QUIZ_ATTEMPT_NOT_OPEN'
  | 'QUIZ_HAS_NO_ACTIVE_QUESTIONS'
  | 'INVALID_QUIZ_LIFECYCLE_TRANSITION'
  | 'QUIZ_NOT_PUBLISHABLE'
  | 'QUIZ_ATTEMPT_LIMIT_REACHED';

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

// A foreign/random Attempt ID, an Attempt belonging to another student, and an Attempt for a
// different Quiz Lesson all collapse to this same error — no existence leakage between "does not
// exist" and "exists but is not yours," matching the IDOR-avoidance convention already
// established for Course/Lesson errors.
export class QuizAttemptNotFoundError extends QuizError {
  constructor() {
    super('QUIZ_ATTEMPT_NOT_FOUND', 'Quiz attempt was not found.');
  }
}

export class QuizAttemptNotOpenError extends QuizError {
  constructor() {
    super('QUIZ_ATTEMPT_NOT_OPEN', 'This quiz attempt is already finalized and can no longer be modified.');
  }
}

export class QuizHasNoActiveQuestionsError extends QuizError {
  constructor() {
    super('QUIZ_HAS_NO_ACTIVE_QUESTIONS', 'This quiz currently has no active questions to attempt.');
  }
}

export class InvalidQuizLifecycleTransitionError extends QuizError {
  constructor() {
    super('INVALID_QUIZ_LIFECYCLE_TRANSITION', 'Quiz lifecycle transition is not allowed.');
  }
}

export class QuizNotPublishableError extends QuizError {
  constructor() {
    super('QUIZ_NOT_PUBLISHABLE', 'Quiz is not complete enough to publish.');
  }
}

// A clean domain error for "you have used up your configured attempts for this Quiz within this
// Enrollment" — never a raw Prisma/DB unique-constraint failure surfaced to the client.
export class QuizAttemptLimitReachedError extends QuizError {
  constructor() {
    super('QUIZ_ATTEMPT_LIMIT_REACHED', 'The maximum number of attempts for this quiz has already been used.');
  }
}
