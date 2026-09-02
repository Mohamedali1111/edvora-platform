// Mirrors apps/api/src/modules/quizzes/types/student-quiz.types.ts and
// student-quiz-attempt.types.ts exactly. Deliberately two separate families,
// matching the backend: `StudentQuizContent` is the pure, attempt-free
// content-delivery shape (safe to fetch on screen-open, never starts an
// attempt); `StudentQuizAttemptDetail` is what an attempt (start/get/answer/
// submit) returns. Neither ever carries `isCorrect`, a correct option id, an
// answer key, or points/scoring-configuration fields — see
// quiz-error-mapping.ts and the milestone report's "Answer Leakage Audit" for
// the backend-side proof this mirrors.

export type QuestionType = 'MULTIPLE_CHOICE' | 'TRUE_FALSE';
export type QuizAttemptStatus = 'IN_PROGRESS' | 'SUBMITTED' | 'GRADED' | 'ABANDONED';

export type StudentQuestionOption = {
  optionId: string;
  label: string | null;
  text: string;
  position: number;
};

export type StudentQuestion = {
  questionId: string;
  type: QuestionType;
  prompt: string;
  position: number;
  options: StudentQuestionOption[];
};

export type StudentQuizContent = {
  quizId: string;
  title: string;
  description: string | null;
  questions: StudentQuestion[];
};

export type StudentQuizAttemptQuestion = {
  questionId: string;
  type: QuestionType;
  prompt: string;
  position: number;
  options: StudentQuestionOption[];
  // The student's own currently-saved selection for this question, or null if
  // unanswered. Never a hint about correctness.
  selectedOptionId: string | null;
};

export type StudentQuizAttemptResult = {
  scorePoints: string;
  maxPoints: string;
  // Null only when maxPoints is zero (not meaningful) — see the backend's own doc comment.
  percentage: string | null;
  // Null when the Quiz had no passing threshold configured when this attempt started.
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
  // Present only once GRADED; null while IN_PROGRESS — there is no score to leak before then.
  result: StudentQuizAttemptResult | null;
};
