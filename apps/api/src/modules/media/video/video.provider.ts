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

// Authoritative, provider-fetched metadata for an existing video — deliberately minimal (just the
// one field the READY-webhook hydration path in `MediaAssetService` needs), not a mirror of
// Bunny's full video object. `durationSeconds` is `null` when Bunny has no usable duration for this
// video yet (never guessed/invented by the caller — see `MediaAssetService.handleVideoProviderWebhook`).
export type ProviderVideoMetadata = {
  durationSeconds: number | null;
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
