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
}
