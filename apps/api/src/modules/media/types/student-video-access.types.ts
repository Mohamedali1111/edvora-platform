/**
 * The truthful response shape for Media Milestone Slice C. No video/streaming provider has been
 * selected yet, so this deliberately carries no playback URL (HLS/DASH or otherwise), signed URL,
 * playback token, DRM license URL, or provider asset ID — those would have to be fabricated. It
 * carries only `durationSeconds`, the one video display field the student Course structure
 * endpoint already exposes for a VIDEO lesson (see `StudentLessonSummary.video` in
 * `student-course.types.ts`), plus `ready`/`authorizedAt` to make explicit that this response is
 * the outcome of a real, just-performed authorization decision — not a cached or assumed state.
 * `videoAssetId` is deliberately omitted: there is no concrete client need for it yet, and
 * omitting it keeps the response minimal, matching the same separation Media Slice A/B and Course
 * Slice C already established.
 */
export type StudentVideoAccessStatus = {
  lessonId: string;
  ready: true;
  durationSeconds: number | null;
  authorizedAt: Date;
};
