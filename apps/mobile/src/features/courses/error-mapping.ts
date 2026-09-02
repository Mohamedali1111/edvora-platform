import { ApiError } from '../../lib/api/errors';
import type { TranslationKey } from '../../lib/i18n/translations';

/**
 * Maps a course/section/lesson content-API failure to a translation key. Mirrors
 * apps/api/src/modules/courses/http/course-error-mapping.ts's codes, but this app
 * only ever needs the read-path subset — the write-path lifecycle/reorder codes
 * (SECTION_POSITION_CONFLICT, INVALID_COURSE_LIFECYCLE_TRANSITION, ...) belong to
 * instructor authoring, never reachable from a student-only read screen.
 *
 * COURSE_NOT_FOUND and LESSON_NOT_FOUND both collapse to the same honest "not
 * available" copy — matching the backend's own deliberate no-existence-leakage
 * design (a foreign, unpublished, or expired id reads identically to one that
 * never existed; see StudentCourseAccessService's doc comments).
 */
export function mapCourseContentError(error: unknown): TranslationKey {
  if (error instanceof ApiError) {
    if (error.kind === 'network') {
      return 'courses.error.network';
    }

    if (error.code === 'COURSE_NOT_FOUND') {
      return 'courses.error.courseNotFound';
    }

    if (error.code === 'LESSON_NOT_FOUND') {
      return 'courses.error.lessonNotFound';
    }
  }

  return 'courses.error.generic';
}
