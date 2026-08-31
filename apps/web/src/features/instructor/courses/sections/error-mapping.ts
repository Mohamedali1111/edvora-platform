import { ApiError } from "../../../../lib/api/client";
import type { TranslationKey } from "../../../../lib/i18n/translations";

export { isNetworkError } from "../../students/error-mapping";

const SECTION_LIFECYCLE_CONFLICT_CODE = "INVALID_SECTION_LIFECYCLE_TRANSITION";

/**
 * Maps a frozen backend error `code` (from the uniform `{ error: { code,
 * message } }` envelope) to a translated, user-facing message key. Only
 * codes the sections feature can actually receive are mapped; everything
 * else falls back to a generic recoverable message. Never surfaces the raw
 * backend `message` string to the UI.
 */
const KNOWN_ERROR_CODE_KEYS: Partial<Record<string, TranslationKey>> = {
  COURSE_NOT_FOUND: "courses.detailNotFound",
  SECTION_NOT_FOUND: "sections.notFoundError",
  [SECTION_LIFECYCLE_CONFLICT_CODE]: "sections.errorInvalidTransition",
  SECTION_POSITION_CONFLICT: "sections.errorPositionConflict",
  INVALID_SECTION_REORDER: "sections.errorInvalidReorder",
  VALIDATION_FAILED: "courses.errorValidation",
};

export function resolveErrorMessageKey(error: unknown, fallback: TranslationKey): TranslationKey {
  if (error instanceof ApiError && error.kind === "backend") {
    return KNOWN_ERROR_CODE_KEYS[error.code] ?? fallback;
  }

  return fallback;
}

/**
 * True when a section action (metadata save, publish, archive) was rejected
 * because the section's lifecycle state moved out from under the page - e.g.
 * another session archived it while this one still had the edit form or a
 * lifecycle dialog open. Callers use this to trigger a refetch of the
 * section list so the page reflects real server state.
 */
export function isSectionLifecycleConflict(error: unknown): boolean {
  return error instanceof ApiError && error.kind === "backend" && error.code === SECTION_LIFECYCLE_CONFLICT_CODE;
}
