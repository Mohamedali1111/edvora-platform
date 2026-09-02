import { ApiError } from '../../../lib/api/errors';
import type { TranslationKey } from '../../../lib/i18n/translations';

/**
 * Maps a definitive (non-ambiguous) POST .../complete rejection to a
 * translation key. Mirrors the exact codes
 * apps/api/src/modules/courses/http/course-error-mapping.ts can return for
 * this endpoint: `COURSE_NOT_FOUND`/`LESSON_NOT_FOUND` (the same
 * no-existence-leakage "not available" collapse `error-mapping.ts` already
 * uses for reads) and `QUIZ_LESSON_COMPLETION_NOT_ALLOWED` (unreachable in
 * practice — QuizLessonScreen never calls this client at all, see
 * quiz/quiz-lesson-screen.tsx — but mapped explicitly anyway per the
 * milestone spec's "map exact completion endpoint errors" requirement,
 * defense in depth rather than an unmapped fallback).
 *
 * This function is never the source of the "ambiguous network" copy: an
 * ApiError with `kind === 'network'` is handled entirely inside
 * use-lesson-completion.ts (attempt reconciliation via `isLessonCompleted`
 * first, only falling back to the dedicated `courses.completion.error.ambiguous`
 * copy baked into completion-state.ts's 'ambiguous' event) — this mapper's own
 * `network` branch exists only so a network-kind ApiError still has an honest,
 * exercised mapping if it ever reaches this function directly (e.g. a test, or
 * the reconciliation read itself failing over network).
 */
export function mapCompletionError(error: unknown): TranslationKey {
  if (error instanceof ApiError) {
    if (error.kind === 'network') {
      return 'courses.completion.error.network';
    }

    if (error.code === 'COURSE_NOT_FOUND' || error.code === 'LESSON_NOT_FOUND') {
      return 'courses.completion.error.notAvailable';
    }

    if (error.code === 'QUIZ_LESSON_COMPLETION_NOT_ALLOWED') {
      return 'courses.completion.error.notAllowed';
    }
  }

  return 'courses.completion.error.generic';
}
