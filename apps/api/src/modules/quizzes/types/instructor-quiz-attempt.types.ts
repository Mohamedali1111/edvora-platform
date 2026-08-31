import type { QuizAttemptStatus } from '../../../../.generated/prisma/client';
import type { StudentContactSummary } from '../../tenancy/types/tenancy.types';

/**
 * Instructor-facing Quiz Attempt reporting row — aggregate results only, deliberately not the
 * per-question answer/answer-key detail `StudentQuizAttemptDetail`'s `answers` carries (that
 * remains backend/student-attempt-owner-only per DEC-0025; this type never includes it). Every
 * score/max/percentage/passed value here is read directly from the persisted `QuizAttempt` row —
 * the exact historical snapshot produced at that attempt's own submission/grading time, never
 * re-derived from the current live Quiz/Question/Option definitions. Reuses the same
 * `StudentContactSummary` boundary already approved for Enrollment Visibility.
 */
export type InstructorQuizAttemptSummary = {
  attemptId: string;
  quizId: string;
  enrollmentId: string;
  student: StudentContactSummary;
  status: QuizAttemptStatus;
  attemptNumber: number;
  // Null until graded (IN_PROGRESS/ABANDONED attempts never populate these on the persisted row).
  scorePoints: string | null;
  maxPoints: string | null;
  // Derived at read time from `scorePoints`/`maxPoints` — never persisted, so it can never drift.
  // Null whenever either is null (not yet graded) or `maxPoints` is zero.
  percentage: string | null;
  passed: boolean | null;
  startedAt: Date;
  submittedAt: Date | null;
};
