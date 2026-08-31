import type { AssetProcessingStatus } from "../../../lib/api/types";

/**
 * Video processing is entirely webhook-driven (Bunny -> backend), never
 * instructor-initiated - see docs/MEDIA.md's Bunny status mapping. This
 * decides whether the current Videos page is worth silently re-fetching:
 * true only while at least one visible video is still `UPLOADING` or
 * `PROCESSING`. `READY`/`FAILED`/`ARCHIVED` are all terminal from the
 * polling loop's point of view - a `FAILED` video needs an explicit new
 * upload, not more polling, and `ARCHIVED` has no lifecycle action here at
 * all (no archive/delete endpoint exists in this frozen API).
 */
export function shouldPollVideos(items: { processingStatus: AssetProcessingStatus }[]): boolean {
  return items.some((item) => item.processingStatus === "UPLOADING" || item.processingStatus === "PROCESSING");
}

/** Bounded, conservative interval - no aggressive spam, no WebSocket/realtime infrastructure. */
export const VIDEO_POLL_INTERVAL_MS = 6000;
