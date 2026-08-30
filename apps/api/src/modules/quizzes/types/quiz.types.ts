import type {
  QuestionStatus,
  QuestionType,
  QuizRevealAnswersPolicy,
  QuizStatus,
} from '../../../../.generated/prisma/client';

/**
 * These are instructor-authoring types only. `QuestionOptionSummary.isCorrect` is
 * correct-answer configuration and must never be reused for a future Student Quiz delivery
 * contract — that will need its own deliberately-scoped response types (mirroring how
 * `courses/types/student-course.types.ts` is a distinct family from the instructor-facing
 * `CourseSummary`/`CourseSectionSummary`/`LessonSummary` types), not these.
 */

export type QuizSummary = {
  quizId: string;
  tenantId: string;
  title: string;
  description: string | null;
  status: QuizStatus;
  passingScorePercent: string | null;
  attemptLimit: number | null;
  revealAnswersPolicy: QuizRevealAnswersPolicy;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type QuestionSummary = {
  questionId: string;
  quizId: string;
  type: QuestionType;
  prompt: string;
  position: number;
  points: string;
  status: QuestionStatus;
  createdAt: Date;
  updatedAt: Date;
};

export type QuestionOptionSummary = {
  optionId: string;
  questionId: string;
  label: string | null;
  text: string;
  position: number;
  isCorrect: boolean;
  createdAt: Date;
  updatedAt: Date;
};
