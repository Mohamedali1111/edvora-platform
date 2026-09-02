export type ProviderVideoResource = {
  videoId: string;
};

export type TusUploadCapability = {
  endpoint: string;
  libraryId: string;
  videoId: string;
  expiresAt: Date;
  headers: Record<string, string>;
};

export type BunnyStreamWebhookStatus =
  | 0
  | 1
  | 2
  | 3
  | 4
  | 5
  | 6
  | 7
  | 8
  | 9
  | 10;

export type BunnyStreamWebhookEvent = {
  libraryId: string;
  videoId: string;
  status: BunnyStreamWebhookStatus;
  durationSeconds: number | null;
};

// A short-lived, path-scoped playback bearer capability: `playbackUrl` is the direct HLS
// `playlist.m3u8` URL, signed so that the authorization also covers every quality sub-playlist and
// segment file Bunny serves under that same video's storage path — never an iframe/embed URL, and
// never a manifest-only token that leaves segment requests unprotected.
export type VideoPlaybackCapability = {
  playbackUrl: string;
  expiresAt: Date;
};

// Authoritative, provider-fetched metadata for an existing video — not a mirror of Bunny's full
// video object, but deliberately extended (see `docs/MEDIA.md`'s status-4 READY-promotion note)
// beyond just duration: real-provider testing proved that a real, fully-encoded Bunny video can
// permanently remain at webhook status 4 ("a resolution finished") and never reach status 3
// ("Finished") — Bunny's status 4 fires the first time as soon as a SINGLE resolution finishes,
// long before the whole encode is done, so it cannot by itself distinguish "one resolution done"
// from "genuinely, fully complete". `status`/`encodeProgress`/`availableResolutions`/
// `hasFailureIndication` exist solely so `MediaAssetService` can authoritatively re-verify a status-4
// webhook against Bunny's own current Get Video state before ever promoting to READY from it — see
// `isResolutionFinishedGenuinelyComplete`. None of these fields are exposed through any public
// (student/instructor) API; this type is internal to the media module only.
export type ProviderVideoMetadata = {
  // `null` when Bunny has no usable duration for this video yet (never guessed/invented by the
  // caller — see `MediaAssetService.handleVideoProviderWebhook`).
  durationSeconds: number | null;
  // Bunny's current numeric status for this video as of this fetch (same enumeration as
  // `BunnyStreamWebhookStatus`), or `null` if the provider adapter has no comparable field.
  status: number | null;
  // 0-100, or `null` if not exposed/unknown. Reflects overall encode completion across every
  // resolution Bunny is producing for this video — NOT per-resolution — which is exactly what makes
  // it a meaningful signal that status 4 means "all resolutions done", not just the first one.
  encodeProgress: number | null;
  // Parsed list of resolution labels Bunny currently reports as available (e.g. `["720p", "1080p"]`),
  // or `null` if not exposed/unknown. Never required to contain a specific hardcoded set/count —
  // callers only check non-emptiness — since instructor/library encoding settings can vary.
  availableResolutions: string[] | null;
  // True only when the provider's own response carries an explicit, non-empty failure/error
  // indication for this video (e.g. Bunny's `transcodingMessages`). `false`/`null` is "no failure
  // signal seen", not "provably healthy" — callers still require the positive completion signals
  // above too, this only ever prevents a promotion, never causes one.
  hasFailureIndication: boolean | null;
};

export interface VideoProvider {
  readonly providerKey: string;

  createVideoResource(input: { title: string }): Promise<ProviderVideoResource>;

  createTusUploadCapability(input: { videoId: string; expiresInSeconds: number; now: Date }): TusUploadCapability;

  // `videoId` must already be a server-proven, tenant-authorized Bunny video GUID (the caller's
  // responsibility — see `StudentVideoAccessService`); this method additionally refuses to sign a
  // `videoId` that is not a well-formed Bunny GUID, rather than embedding arbitrary input into a
  // signed path.
  createPlaybackCapability(input: { videoId: string; expiresInSeconds: number; now: Date }): VideoPlaybackCapability;

  verifyAndParseWebhook(input: { headers: Record<string, string | string[] | undefined>; rawBody: Buffer }): BunnyStreamWebhookEvent;

  // Server-to-server authoritative metadata lookup for an existing video, keyed by the provider's
  // own GUID under this provider's own configured library — used only as a fallback when a real
  // Bunny webhook's own payload did not carry a usable duration (see
  // `MediaAssetService.handleVideoProviderWebhook`). Rejects on a genuine fetch failure (network
  // error, non-OK response) so the caller can decide how to degrade; a reachable-but-duration-less
  // response resolves with `durationSeconds: null` rather than rejecting, since that is not an
  // error condition.
  fetchVideoMetadata(input: { videoId: string }): Promise<ProviderVideoMetadata>;
}
