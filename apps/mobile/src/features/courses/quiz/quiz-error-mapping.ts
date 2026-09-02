import { ApiError } from '../../../lib/api/errors';
import type { TranslationKey } from '../../../lib/i18n/translations';

/**
 * Maps a Quiz/Attempt call failure to a translation key. Mirrors
 * apps/api/src/modules/quizzes/http/quiz-error-mapping.ts's codes plus the
 * shared `LESSON_NOT_FOUND` these endpoints reuse from the courses module
 * (see quiz-availability.ts's doc comment for the same honest-collapse note
 * already established for VIDEO/DOCUMENT).
 */
export function mapQuizError(error: unknown): TranslationKey {
  if (error instanceof ApiError) {
    if (error.kind === 'network') {
      return 'quiz.error.network';
    }

    if (error.code === 'LESSON_NOT_FOUND') {
      return 'quiz.error.notAvailable';
    }

    if (error.code === 'QUIZ_HAS_NO_ACTIVE_QUESTIONS') {
      return 'quiz.error.noQuestions';
    }

    if (error.code === 'QUIZ_ATTEMPT_LIMIT_REACHED') {
      return 'quiz.error.attemptLimitReached';
    }

    if (error.code === 'QUIZ_ATTEMPT_NOT_OPEN') {
      return 'quiz.error.attemptNotOpen';
    }

    if (error.code === 'QUIZ_ATTEMPT_NOT_FOUND') {
      return 'quiz.error.attemptNotFound';
    }

    if (error.code === 'QUESTION_NOT_FOUND' || error.code === 'QUESTION_OPTION_NOT_FOUND') {
      return 'quiz.error.invalidAnswer';
    }
  }

  return 'quiz.error.generic';
}
