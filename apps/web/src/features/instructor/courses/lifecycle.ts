import type { CourseStatus } from "../../../lib/api/types";

/**
 * The frozen backend's only supported transitions (docs/DECISIONS.md
 * DEC-0048, confirmed against the actual service code):
 * DRAFT -> PUBLISHED, DRAFT -> ARCHIVED, PUBLISHED -> ARCHIVED. ARCHIVED is
 * terminal - no unpublish, no restore. Publish/archive are each idempotent
 * on their own already-target status, but the frontend never needs to call
 * either redundantly: these helpers hide the action entirely once it would
 * be a no-op, rather than exposing a button whose only purpose is to repeat
 * the current state.
 */
/**
 * Mirrors the backend's own enforcement (apps/api CourseService.updateCourseMetadata,
 * DEC-0048): ordinary metadata edits are allowed for DRAFT and PUBLISHED, rejected with
 * 409 INVALID_COURSE_LIFECYCLE_TRANSITION once ARCHIVED. This is a genuine product rule,
 * not a frontend guess - the UI must not invite an edit the backend will reject.
 */
export function canEditCourseMetadata(status: CourseStatus): boolean {
  return status !== "ARCHIVED";
}

export function canPublish(status: CourseStatus): boolean {
  return status === "DRAFT";
}

export function canArchive(status: CourseStatus): boolean {
  return status === "DRAFT" || status === "PUBLISHED";
}

export function isTerminal(status: CourseStatus): boolean {
  return status === "ARCHIVED";
}
