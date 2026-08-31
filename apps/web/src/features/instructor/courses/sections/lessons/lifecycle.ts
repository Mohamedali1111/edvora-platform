import type { LessonStatus } from "../../../../../lib/api/types";

/**
 * The frozen backend's Lesson transitions (confirmed against
 * LessonService, matching Course/Section's DEC-0048 enforcement exactly):
 * DRAFT -> PUBLISHED, DRAFT -> ARCHIVED, PUBLISHED -> ARCHIVED. ARCHIVED is
 * terminal - no unpublish, no restore. A Lesson's own status is the only
 * thing that governs its own editability/lifecycle actions: the backend
 * never checks the parent Section's or Course's status in any Lesson
 * service method - confirmed by reading every method (createLesson,
 * listLessons, updateLessonMetadata, archiveLesson, publishLesson,
 * reorderLessons) - so these helpers intentionally take only the Lesson's
 * own status.
 *
 * Publishing additionally requires real content readiness (VIDEO/DOCUMENT
 * asset READY, QUIZ PUBLISHED) - that is a backend-enforced concern
 * surfaced via LESSON_CONTENT_NOT_READY when publish is attempted, not
 * something these status-only helpers predict or gate client-side (the
 * list response doesn't expose asset/quiz readiness, only the lesson's own
 * fields - see lessons-service.ts).
 */
export function canEditLessonMetadata(status: LessonStatus): boolean {
  return status !== "ARCHIVED";
}

export function canPublishLesson(status: LessonStatus): boolean {
  return status === "DRAFT";
}

export function canArchiveLesson(status: LessonStatus): boolean {
  return status === "DRAFT" || status === "PUBLISHED";
}

/**
 * Whether a lesson may appear in a reorder request. The backend's reorder
 * endpoint requires the submitted `lessonIds` to be exactly the set of
 * non-ARCHIVED lessons for the section - an archived lesson retains its own
 * position permanently and is rejected (INVALID_LESSON_REORDER) if included.
 */
export function canReorderLesson(status: LessonStatus): boolean {
  return status !== "ARCHIVED";
}

export function isLessonTerminal(status: LessonStatus): boolean {
  return status === "ARCHIVED";
}
