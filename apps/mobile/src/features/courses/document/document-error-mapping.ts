import { ApiError } from '../../../lib/api/errors';
import type { TranslationKey } from '../../../lib/i18n/translations';

/**
 * Maps a /document/access failure to a translation key. Mirrors
 * apps/api/src/modules/media/http/media-error-mapping.ts's codes plus the
 * shared `LESSON_NOT_FOUND` this endpoint reuses from the courses module.
 *
 * Important honesty note (mirroring video-error-mapping.ts's own note): this
 * endpoint returns `LESSON_NOT_FOUND` for a not-yet-READY document exactly
 * the same as for a genuinely missing/unentitled lesson (see
 * StudentCourseAccessService.assertAccessibleDocumentLesson) — deliberately,
 * to avoid existence leakage. Unlike VIDEO, Course Detail's `document`
 * metadata carries no `processingStatus` field to pre-check against (see
 * course-types.ts), so this screen has no earlier "still processing" signal
 * to show instead — a `LESSON_NOT_FOUND` here always maps to the same honest
 * "not available" copy the Lesson/Course Detail screens already use.
 */
export function mapDocumentAccessError(error: unknown): TranslationKey {
  if (error instanceof ApiError) {
    if (error.kind === 'network') {
      return 'document.error.network';
    }

    if (error.code === 'LESSON_NOT_FOUND') {
      return 'document.error.notAvailable';
    }

    if (error.code === 'DOCUMENT_ASSET_STORAGE_INVARIANT_VIOLATION') {
      return 'document.error.signingFailed';
    }
  }

  return 'document.error.generic';
}
