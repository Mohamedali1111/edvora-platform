import { ApiError } from '../../../lib/api/errors';
import type { TranslationKey } from '../../../lib/i18n/translations';

/**
 * Maps a /video/access failure to a translation key. Mirrors
 * apps/api/src/modules/media/http/media-error-mapping.ts's codes plus the shared
 * `LESSON_NOT_FOUND` this endpoint reuses from the courses module.
 *
 * Important honesty note: this endpoint returns `LESSON_NOT_FOUND` for a
 * not-yet-READY video exactly the same as for a genuinely missing/unentitled
 * lesson (see StudentCourseAccessService.assertAccessibleVideoLesson) — the
 * backend deliberately does not distinguish them here to avoid existence
 * leakage. This screen never calls /video/access at all when Course Detail's
 * own `video.processingStatus` already shows the video isn't READY (see
 * video-lesson-screen.tsx), so in practice a LESSON_NOT_FOUND reaching this
 * mapper means the lesson became unavailable between screens — mapped to the
 * same honest "not available" copy the Lesson/Course Detail screens already use,
 * never a fabricated distinction this endpoint doesn't make.
 */
export function mapVideoAccessError(error: unknown): TranslationKey {
  if (error instanceof ApiError) {
    if (error.kind === 'network') {
      return 'video.error.network';
    }

    if (error.code === 'LESSON_NOT_FOUND') {
      return 'video.error.notAvailable';
    }

    if (error.code === 'VIDEO_PLAYBACK_SIGNING_FAILED' || error.code === 'VIDEO_ASSET_PROVIDER_INVARIANT_VIOLATION') {
      return 'video.error.signingFailed';
    }
  }

  return 'video.error.generic';
}
