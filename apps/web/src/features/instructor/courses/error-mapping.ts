import { ApiError } from "../../../lib/api/client";
import type { TranslationKey } from "../../../lib/i18n/translations";

export { isNetworkError } from "../students/error-mapping";

/**
 * Maps a frozen backend error `code` (from the uniform `{ error: { code,
 * message } }` envelope) to a translated, user-facing message key. Only
 * codes the courses feature can actually receive are mapped; everything
 * else falls back to a generic recoverable message. Never surfaces the raw
 * backend `message` string to the UI.
 */
const COURSE_LIFECYCLE_CONFLICT_CODE = "INVALID_COURSE_LIFECYCLE_TRANSITION";

const KNOWN_ERROR_CODE_KEYS: Partial<Record<string, TranslationKey>> = {
  COURSE_NOT_FOUND: "courses.detailNotFound",
  [COURSE_LIFECYCLE_CONFLICT_CODE]: "courses.errorInvalidTransition",
  VALIDATION_FAILED: "courses.errorValidation",
};

export function resolveErrorMessageKey(error: unknown, fallback: TranslationKey): TranslationKey {
  if (error instanceof ApiError && error.kind === "backend") {
    return KNOWN_ERROR_CODE_KEYS[error.code] ?? fallback;
  }

  return fallback;
}

/**
 * True when a course action (metadata save, publish, archive) was rejected because the
 * course's lifecycle state moved out from under the page - e.g. another session archived
 * it while this one still had the edit form or a lifecycle dialog open. Callers use this to
 * trigger a refetch so the page transitions into the real, current (read-only) state instead
 * of leaving stale controls that would just fail the same way again.
 */
export function isCourseLifecycleConflict(error: unknown): boolean {
  return error instanceof ApiError && error.kind === "backend" && error.code === COURSE_LIFECYCLE_CONFLICT_CODE;
}
