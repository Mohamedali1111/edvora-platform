import type { CourseSummary, CourseStatus } from "../../../lib/api/types";

/**
 * The backend's supported Course transitions (docs/DECISIONS.md DEC-0048,
 * including the 2026-09-03 Take Offline/Restore addenda, confirmed against
 * the actual service code): DRAFT -> PUBLISHED, DRAFT -> ARCHIVED,
 * PUBLISHED -> ARCHIVED, PUBLISHED -> DRAFT (Take Offline), and
 * ARCHIVED -> DRAFT (Restore). None of these cascade to Sections/Lessons,
 * and Restore never infers the resource's prior status - a restored Course
 * always lands on DRAFT regardless of whether it was PUBLISHED before it was
 * archived. Publish/archive/unpublish/restore are each idempotent on their
 * own already-target status, but the frontend never needs to call any of
 * them redundantly: these helpers hide the action entirely once it would be
 * a no-op, rather than exposing a button whose only purpose is to repeat the
 * current state.
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

export function canTakeOffline(status: CourseStatus): boolean {
  return status === "PUBLISHED";
}

export function canArchive(status: CourseStatus): boolean {
  return status === "DRAFT" || status === "PUBLISHED";
}

export function canRestore(status: CourseStatus): boolean {
  return status === "ARCHIVED";
}

export function isArchived(status: CourseStatus): boolean {
  return status === "ARCHIVED";
}

/**
 * Whether a Draft Course on the Courses *list* should offer a one-click
 * "Make live again" action. `publishedAt` is set exactly once, on a Course's
 * very first publish, and is never cleared by Take Offline or Restore (DEC-0050) -
 * so `publishedAt !== null` reliably means "this Course has been live before"
 * even while it currently reads DRAFT. A never-published Draft Course
 * (`publishedAt === null`) deliberately gets no one-click publish action here:
 * the future first-publish Course Review flow (readiness + publish-selected)
 * is the intended path for a Course's *first* publish, and this list must not
 * offer a shortcut that bypasses it. Course Detail's own dedicated lifecycle
 * panel is unaffected by this helper - it keeps the existing granular
 * `/publish` action for any Draft Course, published-before or not.
 */
export function canPublishAgainFromCoursesList(course: Pick<CourseSummary, "status" | "publishedAt">): boolean {
  return course.status === "DRAFT" && course.publishedAt !== null;
}
