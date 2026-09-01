import { ApiError } from "../../../lib/api/client";
import type { TranslationKey } from "../../../lib/i18n/translations";

export { isNetworkError } from "../students/error-mapping";

/**
 * Maps the frozen reporting endpoints' real backend error codes to a
 * translated, user-facing message. Only codes `GET .../courses/:courseId/
 * progress` and `GET .../quizzes/:quizId/attempts` can actually return -
 * see the Slice G API inventory in the implementation report. Everything
 * else falls back to the caller-supplied generic message; the raw backend
 * `message` string is never surfaced.
 */
const KNOWN_ERROR_CODE_KEYS: Partial<Record<string, TranslationKey>> = {
  COURSE_NOT_FOUND: "progress.errorCourseNotFound",
  QUIZ_NOT_FOUND: "progress.errorQuizNotFound",
  VALIDATION_FAILED: "progress.errorValidation",
};

export function resolveErrorMessageKey(error: unknown, fallback: TranslationKey): TranslationKey {
  if (error instanceof ApiError && error.kind === "backend") {
    return KNOWN_ERROR_CODE_KEYS[error.code] ?? fallback;
  }

  return fallback;
}
