import type { QuestionType, QuizAttemptStatus } from '../../../../.generated/prisma/client';

/**
 * Student-facing Quiz Attempt response shapes — a completely separate family from both the
 * instructor authoring types (`quiz.types.ts`) and the pre-attempt content-delivery types
 * (`student-quiz.types.ts`). Before an attempt is finalized, nothing here ever carries
 * `isCorrect`, a correct Option ID, an answer key, or awarded-points/scoring internals — those
 * live only in `QuizAttemptAnswer.correctAnswerSnapshot`/`pointsAwarded`, which this family never
 * surfaces pre-submission. Per DEC-0025 and this slice's conservative reveal-policy decision
 * (`revealAnswersPolicy` semantics are not fully documented anywhere in this repository), no
 * per-question correctness is ever exposed by this API, even after submission — only the
 * aggregate `StudentQuizAttemptResult` (score/percentage/pass-fail) is revealed once GRADED.
 */

export type StudentQuizAttemptOption = {
  optionId: string;
  label: string | null;
  text: string;
  position: number;
};

export type StudentQuizAttemptQuestion = {
  questionId: string;
  type: QuestionType;
  prompt: string;
  position: number;
  options: StudentQuizAttemptOption[];
  // The student's own currently-saved selection for this question, or null if unanswered. Never
  // another student's selection — every read is scoped to the attempt's own owning student.
  selectedOptionId: string | null;
};

export type StudentQuizAttemptResult = {
  scorePoints: string;
  maxPoints: string;
  // Derived at read time from `scorePoints`/`maxPoints` — never persisted, so it can never drift
  // from the two values it is computed from. Null only in the edge case where `maxPoints` is
  // zero (every snapshotted Question had zero points), where a percentage is not meaningful.
  percentage: string | null;
  // Null when the Quiz has no `passingScorePercent` configured — there is no threshold to
  // evaluate against, so "passed" is not a yes/no fact for this attempt.
  passed: boolean | null;
  gradedAt: string;
};

export type StudentQuizAttemptDetail = {
  attemptId: string;
  quizId: string;
  status: QuizAttemptStatus;
  attemptNumber: number;
  startedAt: string;
  submittedAt: string | null;
  questions: StudentQuizAttemptQuestion[];
  // Present only once the attempt is GRADED; null while IN_PROGRESS. Its absence pre-submission
  // is itself part of the answer-key safety guarantee — there is no score to leak before then.
  result: StudentQuizAttemptResult | null;
};
