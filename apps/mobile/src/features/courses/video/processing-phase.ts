import type { AssetProcessingStatus } from '../course-types';

// What the Video Lesson screen should show BEFORE ever calling /video/access —
// derived entirely from `video.processingStatus`, already returned by Course
// Detail (see course-types.ts). This is the real "processing/not-ready" signal
// the milestone asks for: the /video/access endpoint itself cannot distinguish
// "still processing" from "not entitled" (both collapse to LESSON_NOT_FOUND —
// see video-error-mapping.ts's doc comment), so this screen never calls it at
// all while the asset isn't READY.
export type VideoProcessingPhase = 'ready' | 'processing' | 'failed' | 'unavailable';

export function resolveVideoProcessingPhase(status: AssetProcessingStatus): VideoProcessingPhase {
  if (status === 'READY') {
    return 'ready';
  }

  if (status === 'UPLOADING' || status === 'PROCESSING') {
    return 'processing';
  }

  if (status === 'FAILED') {
    return 'failed';
  }

  // ARCHIVED (and any future status this client doesn't yet recognize): a
  // published Lesson pointing at a non-ready, non-processing, non-failed asset
  // is an authoring-side inconsistency this client did not create — render the
  // same honest "not available" state rather than guessing.
  return 'unavailable';
}
