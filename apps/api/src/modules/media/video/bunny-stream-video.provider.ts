import { Inject, Injectable } from '@nestjs/common';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { MEDIA_RUNTIME_CONFIG } from '../media.constants';
import type { MediaRuntimeConfig } from '../media.config';
import {
  InvalidVideoProviderWebhookError,
  VideoProviderCreateFailedError,
} from '../errors/media.errors';
import type {
  BunnyStreamWebhookEvent,
  BunnyStreamWebhookStatus,
  ProviderVideoResource,
  TusUploadCapability,
  VideoProvider,
} from './video.provider';

type BunnyCreateVideoResponse = {
  guid?: unknown;
};

@Injectable()
export class BunnyStreamVideoProvider implements VideoProvider {
  private readonly libraryId: string;
  private readonly apiKey: string;
  private readonly webhookSigningSecret: string;
  private readonly tusUploadUrl: string;

  constructor(@Inject(MEDIA_RUNTIME_CONFIG) config: MediaRuntimeConfig) {
    this.libraryId = config.video.bunnyStream.libraryId;
    this.apiKey = config.video.bunnyStream.apiKey;
    this.webhookSigningSecret = config.video.bunnyStream.webhookSigningSecret;
    this.tusUploadUrl = config.video.bunnyStream.tusUploadUrl;
  }

  get providerKey(): string {
    return this.libraryId;
  }

  async createVideoResource(input: { title: string }): Promise<ProviderVideoResource> {
    const response = await fetch(`https://video.bunnycdn.com/library/${this.libraryId}/videos`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        AccessKey: this.apiKey,
      },
      body: JSON.stringify({ title: input.title }),
    });

    if (!response.ok) {
      throw new VideoProviderCreateFailedError();
    }

    const body = (await response.json()) as BunnyCreateVideoResponse;
    if (typeof body.guid !== 'string' || !body.guid.trim()) {
      throw new VideoProviderCreateFailedError();
    }

    return { videoId: body.guid };
  }

  createTusUploadCapability(input: { videoId: string; expiresInSeconds: number; now: Date }): TusUploadCapability {
    const expiresUnixSeconds = Math.floor(input.now.getTime() / 1000) + input.expiresInSeconds;
    const signature = createHash('sha256')
      .update(`${this.libraryId}${this.apiKey}${expiresUnixSeconds}${input.videoId}`)
      .digest('hex');

    return {
      endpoint: this.tusUploadUrl,
      libraryId: this.libraryId,
      videoId: input.videoId,
      expiresAt: new Date(expiresUnixSeconds * 1000),
      headers: {
        AuthorizationSignature: signature,
        AuthorizationExpire: String(expiresUnixSeconds),
        VideoId: input.videoId,
        LibraryId: this.libraryId,
      },
    };
  }

  verifyAndParseWebhook(input: {
    headers: Record<string, string | string[] | undefined>;
    rawBody: Buffer;
  }): BunnyStreamWebhookEvent {
    const version = readHeader(input.headers, 'x-bunnystream-signature-version');
    const algorithm = readHeader(input.headers, 'x-bunnystream-signature-algorithm');
    const signature = readHeader(input.headers, 'x-bunnystream-signature');

    if (version !== 'v1' || algorithm !== 'hmac-sha256' || !/^[0-9a-f]{64}$/.test(signature)) {
      throw new InvalidVideoProviderWebhookError();
    }

    const expected = createHmac('sha256', this.webhookSigningSecret).update(input.rawBody).digest('hex');
    if (!timingSafeHexEqual(signature, expected)) {
      throw new InvalidVideoProviderWebhookError();
    }

    return parseWebhookPayload(input.rawBody);
  }
}

function readHeader(headers: Record<string, string | string[] | undefined>, name: string): string {
  const value = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

function timingSafeHexEqual(actualHex: string, expectedHex: string): boolean {
  const actual = Buffer.from(actualHex, 'hex');
  const expected = Buffer.from(expectedHex, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function parseWebhookPayload(rawBody: Buffer): BunnyStreamWebhookEvent {
  let payload: unknown;

  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    throw new InvalidVideoProviderWebhookError();
  }

  if (!payload || typeof payload !== 'object') {
    throw new InvalidVideoProviderWebhookError();
  }

  const record = payload as Record<string, unknown>;
  const libraryId = readStringOrNumber(record.VideoLibraryId);
  const videoId = readStringOrNumber(record.VideoGuid);
  const status = record.Status;

  if (!libraryId || !videoId || !isBunnyStreamWebhookStatus(status)) {
    throw new InvalidVideoProviderWebhookError();
  }

  return {
    libraryId,
    videoId,
    status,
    durationSeconds: readNullableNonNegativeInteger(record.Length ?? record.length),
  };
}

function readStringOrNumber(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }

  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) {
    return String(value);
  }

  return null;
}

function readNullableNonNegativeInteger(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    return null;
  }

  return value;
}

function isBunnyStreamWebhookStatus(value: unknown): value is BunnyStreamWebhookStatus {
  return (
    value === 0 ||
    value === 1 ||
    value === 2 ||
    value === 3 ||
    value === 4 ||
    value === 5 ||
    value === 6 ||
    value === 7 ||
    value === 8 ||
    value === 9 ||
    value === 10
  );
}
