/**
 * The truthful response shape for Media Milestone Slice B. No provider/storage vendor has been
 * selected yet, so this deliberately carries no signed URL, download token, or expiry — those
 * would have to be fabricated. It carries only the same safe, non-leaking document metadata
 * already exposed by the student Course structure endpoint (see `StudentLessonSummary.document`
 * in `student-course.types.ts`), plus `ready`/`authorizedAt` to make explicit that this response
 * is the outcome of a real, just-performed authorization decision — not a cached or assumed
 * state. `documentAssetId`, `externalAssetRef`, `mimeType`'s storage/provider counterparts, and
 * every other instructor-authoring/provider-internal field are deliberately never included here,
 * matching the same separation Media Slice A and Course Slice C already established.
 */
export type StudentDocumentAccessStatus = {
  lessonId: string;
  fileName: string;
  mimeType: string;
  fileSizeBytes: string;
  ready: true;
  authorizedAt: Date;
};
