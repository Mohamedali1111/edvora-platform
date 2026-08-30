/**
 * Student video access carries safe display metadata plus a short-lived, path-scoped Bunny Stream
 * HLS playback bearer capability for the already-proven READY `VideoAsset`. It deliberately excludes
 * `videoAssetId`, `tenantId`, `externalAssetRef`, `providerKey`, `processingStatus`, and every other
 * instructor-authoring/provider-internal field. The Bunny video GUID does appear embedded inside
 * `playbackUrl`'s signed path — that is acceptable as part of the short-lived capability itself, but
 * it is never returned as a separate field.
 */
export type StudentVideoAccessStatus = {
  lessonId: string;
  durationSeconds: number | null;
  playbackUrl: string;
  expiresAt: Date;
};
