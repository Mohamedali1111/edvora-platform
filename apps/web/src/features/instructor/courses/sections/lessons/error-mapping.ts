import { ApiError } from "../../../../../lib/api/client";
import type { TranslationKey } from "../../../../../lib/i18n/translations";

export { isNetworkError } from "../../../students/error-mapping";

const LESSON_LIFECYCLE_CONFLICT_CODE = "INVALID_LESSON_LIFECYCLE_TRANSITION";

/**
 * Maps a frozen backend error `code` (from the uniform `{ error: { code,
 * message } }` envelope) to a translated, user-facing message key. Only
 * codes the lessons feature can actually receive are mapped; everything
 * else falls back to a generic recoverable message. Never surfaces the raw
 * backend `message` string to the UI.
 */
const KNOWN_ERROR_CODE_KEYS: Partial<Record<string, TranslationKey>> = {
  COURSE_NOT_FOUND: "courses.detailNotFound",
  SECTION_NOT_FOUND: "sections.notFoundError",
  LESSON_NOT_FOUND: "lessons.notFoundError",
  [LESSON_LIFECYCLE_CONFLICT_CODE]: "lessons.errorInvalidTransition",
  LESSON_CONTENT_NOT_READY: "lessons.errorContentNotReady",
  LESSON_POSITION_CONFLICT: "lessons.errorPositionConflict",
  INVALID_LESSON_REORDER: "lessons.errorInvalidReorder",
  INVALID_LESSON_TYPE_REFERENCE: "lessons.errorInvalidTypeReference",
  LESSON_REFERENCE_NOT_FOUND: "lessons.errorReferenceNotFound",
  VALIDATION_FAILED: "courses.errorValidation",
};

export function resolveErrorMessageKey(error: unknown, fallback: TranslationKey): TranslationKey {
  if (error instanceof ApiError && error.kind === "backend") {
    return KNOWN_ERROR_CODE_KEYS[error.code] ?? fallback;
  }

  return fallback;
}

/**
 * True when a lesson action (metadata save, publish, archive) was rejected
 * because the lesson's lifecycle state moved out from under the page - e.g.
 * another session archived it while this one still had the edit form or a
 * lifecycle dialog open. Callers use this to trigger a refetch of the
 * lesson list so the page reflects real server state.
 */
export function isLessonLifecycleConflict(error: unknown): boolean {
  return error instanceof ApiError && error.kind === "backend" && error.code === LESSON_LIFECYCLE_CONFLICT_CODE;
}
