import { ApiError } from "../../../lib/api/client";
import type { TranslationKey } from "../../../lib/i18n/translations";

export { isNetworkError } from "../students/error-mapping";

/**
 * Maps the frozen Instructor notification endpoints' real backend error
 * codes to translated copy. `NOTIFICATION_NOT_FOUND` is the only one this
 * feature can realistically hit in normal use (marking a notification read
 * by an id the current list already returned); `INSTRUCTOR_REQUIRED` is a
 * role-gate error that shouldn't occur inside an authenticated instructor
 * session and falls back to the generic message, same convention as every
 * other feature's error-mapping module. The raw backend `message` string is
 * never surfaced.
 */
const KNOWN_ERROR_CODE_KEYS: Partial<Record<string, TranslationKey>> = {
  NOTIFICATION_NOT_FOUND: "notifications.errorNotFound",
};

export function resolveErrorMessageKey(error: unknown, fallback: TranslationKey): TranslationKey {
  if (error instanceof ApiError && error.kind === "backend") {
    return KNOWN_ERROR_CODE_KEYS[error.code] ?? fallback;
  }

  return fallback;
}
