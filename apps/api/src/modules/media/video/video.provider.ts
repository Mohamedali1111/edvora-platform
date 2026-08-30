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

export interface VideoProvider {
  readonly providerKey: string;

  createVideoResource(input: { title: string }): Promise<ProviderVideoResource>;

  createTusUploadCapability(input: { videoId: string; expiresInSeconds: number; now: Date }): TusUploadCapability;

  verifyAndParseWebhook(input: { headers: Record<string, string | string[] | undefined>; rawBody: Buffer }): BunnyStreamWebhookEvent;
}
