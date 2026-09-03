import { QuestionType, QuizStatus } from '../../../../.generated/prisma/client';
import { QuizNotPublishableError } from '../errors/quiz.errors';
import {
  assertQuizPublishable,
  evaluateQuizPublishability,
  type QuizPublishabilityRow,
} from './quiz-publishability.util';

function decimal(value: number): { toNumber(): number } {
  return { toNumber: () => value };
}

function validQuiz(overrides: Partial<QuizPublishabilityRow> = {}): QuizPublishabilityRow {
  return {
    status: QuizStatus.DRAFT,
    passingScorePercent: null,
    attemptLimit: null,
    questions: [
      {
        type: QuestionType.TRUE_FALSE,
        points: decimal(1),
        options: [{ isCorrect: true }, { isCorrect: false }],
      },
    ],
    ...overrides,
  };
}

describe('evaluateQuizPublishability', () => {
  it('returns no reasons for a valid aggregate', () => {
    expect(evaluateQuizPublishability(validQuiz())).toEqual([]);
  });

  it('reports QUIZ_NOT_PUBLISHABLE_NO_QUESTIONS for zero active questions', () => {
    expect(evaluateQuizPublishability(validQuiz({ questions: [] }))).toEqual([
      'QUIZ_NOT_PUBLISHABLE_NO_QUESTIONS',
    ]);
  });

  it('reports QUIZ_NOT_PUBLISHABLE_MISSING_CORRECT_OPTION when a question has zero correct options', () => {
    const quiz = validQuiz({
      questions: [
        {
          type: QuestionType.TRUE_FALSE,
          points: decimal(1),
          options: [{ isCorrect: false }, { isCorrect: false }],
        },
      ],
    });
    expect(evaluateQuizPublishability(quiz)).toEqual(['QUIZ_NOT_PUBLISHABLE_MISSING_CORRECT_OPTION']);
  });

  it('reports QUIZ_NOT_PUBLISHABLE_MISSING_CORRECT_OPTION when a question has more than one correct option', () => {
    const quiz = validQuiz({
      questions: [
        {
          type: QuestionType.MULTIPLE_CHOICE,
          points: decimal(1),
          options: [{ isCorrect: true }, { isCorrect: true }, { isCorrect: false }],
        },
      ],
    });
    expect(evaluateQuizPublishability(quiz)).toEqual(['QUIZ_NOT_PUBLISHABLE_MISSING_CORRECT_OPTION']);
  });

  it('reports QUIZ_NOT_PUBLISHABLE_INVALID_POINTS for a non-positive question points value', () => {
    const quiz = validQuiz({
      questions: [{ type: QuestionType.TRUE_FALSE, points: decimal(0), options: [{ isCorrect: true }, { isCorrect: false }] }],
    });
    expect(evaluateQuizPublishability(quiz)).toEqual(['QUIZ_NOT_PUBLISHABLE_INVALID_POINTS']);
  });

  it('reports QUIZ_NOT_PUBLISHABLE_INVALID_POINTS for a TRUE_FALSE question without exactly 2 options', () => {
    const quiz = validQuiz({
      questions: [
        {
          type: QuestionType.TRUE_FALSE,
          points: decimal(1),
          options: [{ isCorrect: true }],
        },
      ],
    });
    expect(evaluateQuizPublishability(quiz)).toEqual(['QUIZ_NOT_PUBLISHABLE_INVALID_POINTS']);
  });

  it('reports QUIZ_NOT_PUBLISHABLE_INVALID_POINTS for a MULTIPLE_CHOICE question with fewer than 2 options', () => {
    const quiz = validQuiz({
      questions: [
        {
          type: QuestionType.MULTIPLE_CHOICE,
          points: decimal(1),
          options: [{ isCorrect: true }],
        },
      ],
    });
    expect(evaluateQuizPublishability(quiz)).toEqual(['QUIZ_NOT_PUBLISHABLE_INVALID_POINTS']);
  });

  it('reports QUIZ_NOT_PUBLISHABLE_INVALID_POINTS for an out-of-range passingScorePercent', () => {
    expect(evaluateQuizPublishability(validQuiz({ passingScorePercent: decimal(101) }))).toEqual([
      'QUIZ_NOT_PUBLISHABLE_INVALID_POINTS',
    ]);
    expect(evaluateQuizPublishability(validQuiz({ passingScorePercent: decimal(-1) }))).toEqual([
      'QUIZ_NOT_PUBLISHABLE_INVALID_POINTS',
    ]);
  });

  it('reports QUIZ_NOT_PUBLISHABLE_INVALID_POINTS for an attemptLimit below 1', () => {
    expect(evaluateQuizPublishability(validQuiz({ attemptLimit: 0 }))).toEqual([
      'QUIZ_NOT_PUBLISHABLE_INVALID_POINTS',
    ]);
  });

  it('collects every distinct violation across multiple questions, not just the first', () => {
    const quiz = validQuiz({
      questions: [
        { type: QuestionType.TRUE_FALSE, points: decimal(0), options: [{ isCorrect: true }, { isCorrect: false }] },
        {
          type: QuestionType.MULTIPLE_CHOICE,
          points: decimal(1),
          options: [{ isCorrect: false }, { isCorrect: false }],
        },
      ],
    });
    const reasons = evaluateQuizPublishability(quiz);
    expect(reasons).toContain('QUIZ_NOT_PUBLISHABLE_INVALID_POINTS');
    expect(reasons).toContain('QUIZ_NOT_PUBLISHABLE_MISSING_CORRECT_OPTION');
    expect(reasons).toHaveLength(2);
  });
});

describe('assertQuizPublishable', () => {
  it('does not throw for a valid aggregate', () => {
    expect(() => assertQuizPublishable(validQuiz())).not.toThrow();
  });

  it('throws QuizNotPublishableError (unchanged behavior) whenever evaluateQuizPublishability finds any issue', () => {
    expect(() => assertQuizPublishable(validQuiz({ questions: [] }))).toThrow(QuizNotPublishableError);
  });
});
