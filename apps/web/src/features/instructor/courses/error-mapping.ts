import { ApiError } from "../../../lib/api/client";
import type { TranslationKey } from "../../../lib/i18n/translations";
import type { ReadinessIssue } from "../../../lib/api/types";

export { isNetworkError } from "../students/error-mapping";

/**
 * Maps a frozen backend error `code` (from the uniform `{ error: { code,
 * message } }` envelope) to a translated, user-facing message key. Only
 * codes the courses feature can actually receive are mapped; everything
 * else falls back to a generic recoverable message. Never surfaces the raw
 * backend `message` string to the UI.
 */
const COURSE_LIFECYCLE_CONFLICT_CODE = "INVALID_COURSE_LIFECYCLE_TRANSITION";
const COURSE_ALREADY_PUBLISHED_ONCE_CODE = "COURSE_ALREADY_PUBLISHED_ONCE";
const PUBLISH_SELECTION_STALE_CODE = "PUBLISH_SELECTION_STALE";

const KNOWN_ERROR_CODE_KEYS: Partial<Record<string, TranslationKey>> = {
  COURSE_NOT_FOUND: "courses.detailNotFound",
  [COURSE_LIFECYCLE_CONFLICT_CODE]: "courses.errorInvalidTransition",
  [COURSE_ALREADY_PUBLISHED_ONCE_CODE]: "courses.errorAlreadyPublishedOnce",
  [PUBLISH_SELECTION_STALE_CODE]: "courses.publishReviewStaleExplain",
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

/**
 * True when "Review & publish" (or a stale retry of it) was rejected because
 * this Course was already published once before - the first-publish
 * selection review only ever applies to a Course's genuine first
 * publication (DEC-0050); a Course that reaches this state must use the
 * existing granular `/publish` ("Make live again") instead. See
 * first-publish.ts's `resolveCourseHeaderPrimaryAction`, which is expected
 * to already prevent this by only offering "Review & publish" for a
 * never-published Draft Course - this is a defensive backstop, not the
 * primary gate.
 */
export function isCourseAlreadyPublishedOnce(error: unknown): boolean {
  return error instanceof ApiError && error.kind === "backend" && error.code === COURSE_ALREADY_PUBLISHED_ONCE_CODE;
}

/**
 * True when `publish-selected` rejected the reviewed selection as stale
 * (PUBLISH_SELECTION_STALE, 409) - expected concurrency behavior (the
 * Course changed under the instructor while they were reviewing it), not a
 * generic failure. See `extractStaleBlockers` for the accompanying current
 * blockers, and readiness-copy.ts for turning those into UI messages.
 */
export function isPublishSelectionStale(error: unknown): boolean {
  return error instanceof ApiError && error.kind === "backend" && error.code === PUBLISH_SELECTION_STALE_CODE;
}

/**
 * The reviewed selection's current, machine-readable blockers - present
 * only alongside `PUBLISH_SELECTION_STALE` (see BackendErrorEnvelope/
 * ApiClient.details in lib/api). Returns `null` for every other error, or
 * if the field is unexpectedly missing/malformed, so callers can always
 * fall back to a generic stale explanation without a runtime crash.
 */
export function extractStaleBlockers(error: unknown): ReadinessIssue[] | null {
  if (!isPublishSelectionStale(error) || !(error instanceof ApiError)) {
    return null;
  }

  const blockers = error.details?.blockers;
  return Array.isArray(blockers) ? (blockers as ReadinessIssue[]) : null;
}
