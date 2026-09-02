import type { QuizStatus } from '../course-types';

// What the Quiz Lesson screen should show BEFORE ever calling GET .../quiz —
// derived entirely from `quiz.status`, already returned by Course Detail (see
// course-types.ts), mirroring the same pre-check pattern already established
// for VIDEO's `processingStatus` (video/processing-phase.ts). Unlike VIDEO,
// this pre-check is only an optimization (Course Detail's `quiz.status` is
// the Quiz's own authoring status, and `assertAccessibleQuizLesson` requires
// exactly `PUBLISHED`) — even if this were skipped, an unpublished Quiz would
// still safely collapse to the same honest `LESSON_NOT_FOUND` the content-
// delivery call itself returns (see quiz-error-mapping.ts).
export type QuizAvailabilityPhase = 'ready' | 'draft' | 'unavailable';

export function resolveQuizAvailabilityPhase(status: QuizStatus): QuizAvailabilityPhase {
  if (status === 'PUBLISHED') {
    return 'ready';
  }

  if (status === 'DRAFT') {
    return 'draft';
  }

  // ARCHIVED (and any future status this client doesn't yet recognize): a
  // published Lesson pointing at a non-published, non-draft Quiz is an
  // authoring-side inconsistency this client did not create — render the
  // same honest "not available" state rather than guessing.
  return 'unavailable';
}
