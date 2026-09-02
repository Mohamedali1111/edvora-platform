import { Inject, Injectable } from '@nestjs/common';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { MEDIA_RUNTIME_CONFIG } from '../media.constants';
import type { MediaRuntimeConfig } from '../media.config';
import {
  InvalidVideoProviderWebhookError,
  VideoPlaybackSigningFailedError,
  VideoProviderCreateFailedError,
  VideoProviderMetadataFetchFailedError,
} from '../errors/media.errors';
import type {
  BunnyStreamWebhookEvent,
  BunnyStreamWebhookStatus,
  ProviderVideoMetadata,
  ProviderVideoResource,
  TusUploadCapability,
  VideoPlaybackCapability,
  VideoProvider,
} from './video.provider';

type BunnyCreateVideoResponse = {
  guid?: unknown;
};

// Bunny's "Get Video" response — deliberately typed as `unknown` field-by-field and read
// defensively (see `fetchVideoMetadata`): this is a real third-party payload, not a value this
// codebase controls the shape of. Extended (beyond the pre-existing `length`) with the fields
// `MediaAssetService`'s status-4 READY-promotion check needs — confirmed against the real Bunny API
// during real-provider QA: `status` (same numeric enum as the webhook `Status` field),
// `encodeProgress` (0-100, overall across every resolution, not per-resolution),
// `availableResolutions` (a comma-separated string, e.g. `"360p,480p,720p"`, not an array — Bunny's
// actual wire shape), `transcodingMessages` (an array; non-empty entries are treated as a failure
// signal).
type BunnyGetVideoResponse = {
  length?: unknown;
  status?: unknown;
  encodeProgress?: unknown;
  availableResolutions?: unknown;
  transcodingMessages?: unknown;
};

// Bunny Stream video GUIDs are standard GUIDs (see Bunny's Create Video response). This is
// deliberately checked before a `videoId` is ever embedded into a signed CDN path — a malformed
// value is refused rather than signed, matching `docs/MEDIA.md`'s READY/provider-identity invariant.
const BUNNY_VIDEO_GUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class BunnyStreamVideoProvider implements VideoProvider {
  private readonly libraryId: string;
  private readonly apiKey: string;
  private readonly webhookSigningSecret: string;
  private readonly tusUploadUrl: string;
  private readonly cdnHostname: string;
  private readonly tokenAuthenticationKey: string;

  constructor(@Inject(MEDIA_RUNTIME_CONFIG) config: MediaRuntimeConfig) {
    this.libraryId = config.video.bunnyStream.libraryId;
    this.apiKey = config.video.bunnyStream.apiKey;
    this.webhookSigningSecret = config.video.bunnyStream.webhookSigningSecret;
    this.tusUploadUrl = config.video.bunnyStream.tusUploadUrl;
    this.cdnHostname = config.video.bunnyStream.cdnHostname;
    this.tokenAuthenticationKey = config.video.bunnyStream.tokenAuthenticationKey;
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

  /**
   * Authoritative server-to-server metadata lookup, used for two purposes in
   * `MediaAssetService.handleVideoProviderWebhook`: (1) the pre-existing duration-hydration
   * fallback when a real Bunny READY webhook's own `Length` field was absent/invalid, and (2) the
   * status-4 READY-promotion re-verification — real-provider QA proved a genuinely, fully-encoded
   * Bunny video can permanently sit at webhook status 4 and never emit status 3, so status 4 alone
   * is not trustworthy; this fetch re-confirms Bunny's *current* full state before any promotion.
   * Uses this provider's own configured `libraryId`/`apiKey` — never a caller-supplied library —
   * against Bunny's existing "Get Video" Stream endpoint, the same host/credential already used by
   * `createVideoResource` above.
   *
   * A non-OK response or network failure rejects with a typed error so the caller can choose how to
   * degrade (neither existing caller lets this failure corrupt state — the READY-webhook duration
   * hydration path degrades to `durationSeconds: null`, and the new status-4 promotion path degrades
   * to staying PROCESSING; see `docs/MEDIA.md`). A reachable response missing a given field resolves
   * with `null` for that field — not an error, just "still unknown" — reusing the same
   * `readNullableNonNegativeInteger` normalization the webhook body parser below already applies to
   * `Length`, so both duration sources are held to one identical validity rule.
   */
  async fetchVideoMetadata(input: { videoId: string }): Promise<ProviderVideoMetadata> {
    let response: Response;

    try {
      response = await fetch(`https://video.bunnycdn.com/library/${this.libraryId}/videos/${input.videoId}`, {
        method: 'GET',
        headers: {
          accept: 'application/json',
          AccessKey: this.apiKey,
        },
      });
    } catch {
      throw new VideoProviderMetadataFetchFailedError();
    }

    if (!response.ok) {
      throw new VideoProviderMetadataFetchFailedError();
    }

    let body: BunnyGetVideoResponse;

    try {
      body = (await response.json()) as BunnyGetVideoResponse;
    } catch {
      throw new VideoProviderMetadataFetchFailedError();
    }

    return {
      durationSeconds: readNullableNonNegativeInteger(body.length),
      status: readNullableStatus(body.status),
      encodeProgress: readNullableEncodeProgress(body.encodeProgress),
      availableResolutions: readNullableResolutionList(body.availableResolutions),
      hasFailureIndication: readHasFailureIndication(body.transcodingMessages),
    };
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

  /**
   * Signs a short-lived, path-scoped direct HLS playback URL using Bunny's CDN Pull Zone "advanced"
   * (directory) token authentication — the mechanism `bunny.net/docs/stream/security` documents as
   * protecting "MP4 fallbacks, HLS playlists and segments, thumbnails, and previews" at the Pull
   * Zone level. This is deliberately NOT the separate embed/iframe view-token mechanism
   * (`SHA256_HEX(key + videoId + expires)` on `/embed/{libraryId}/{videoId}`), which only gates
   * Bunny's own iframe player page and does nothing to protect the underlying HLS files a native
   * player (AVPlayer/ExoPlayer) actually fetches.
   *
   * All of a video's files (`playlist.m3u8`, per-resolution sub-playlists, and every segment) live
   * under one Bunny-managed prefix, `/{videoId}/` (see Bunny's "Video storage structure" docs), so
   * signing a directory token scoped to exactly that prefix (`token_path=/{videoId}/`,
   * `isDirectory: true`) authorizes the manifest and every segment/quality file a player resolves
   * relative to it — never a manifest-only token that leaves segment requests unprotected — while
   * staying scoped to this one video only.
   *
   * The token is embedded as a URL path segment (`/bcdn_token=...&token_path=...&expires=.../{videoId}/playlist.m3u8`),
   * not a query string appended to the manifest URL. This is Bunny's documented "directory token"
   * pattern, and it is the one that works with native players: because HLS clients resolve relative
   * segment URIs against everything before the last `/` of the manifest URL they fetched, the
   * `/bcdn_token=...&expires=.../{videoId}/` prefix is carried forward into every segment request
   * automatically. A query-string token (`?token=...`) would NOT do this — the player would have to
   * re-append it to each derived segment URL itself, which is exactly the documented iOS/native HLS
   * limitation this design avoids (see `docs/MEDIA.md`).
   *
   * No `user_ip` is folded into the signature for V1 — see the IP-binding decision in
   * `docs/MEDIA.md`. This is a synchronous, local HMAC computation; it makes no network call, so
   * there is no transient-failure mode beyond the `videoId` shape check below.
   */
  createPlaybackCapability(input: { videoId: string; expiresInSeconds: number; now: Date }): VideoPlaybackCapability {
    if (!BUNNY_VIDEO_GUID_PATTERN.test(input.videoId)) {
      throw new VideoPlaybackSigningFailedError();
    }

    const expiresUnixSeconds = Math.floor(input.now.getTime() / 1000) + input.expiresInSeconds;
    const expires = String(expiresUnixSeconds);
    const tokenPath = `/${input.videoId}/`;
    const urlEncodedTokenPath = encodeURIComponent(tokenPath);
    // Bunny's directory-token signature folds the (path, expires, signing-data) tuple, where
    // `signing_data` here is exactly the one extra `token_path` parameter we set, as
    // `key=value` — unencoded in the signature, URL-encoded in the resulting query string.
    const signingData = `token_path=${tokenPath}`;

    const digest = createHmac('sha256', this.tokenAuthenticationKey)
      .update(tokenPath)
      .update(expires)
      .update(signingData)
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const playbackUrl =
      `https://${this.cdnHostname}/bcdn_token=HS256-${digest}` +
      `&token_path=${urlEncodedTokenPath}&expires=${expires}${tokenPath}playlist.m3u8`;

    return {
      playbackUrl,
      expiresAt: new Date(expiresUnixSeconds * 1000),
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

// Bunny's Get Video `status` field uses the same numeric enumeration as the webhook `Status` field
// (confirmed against the real API during real-provider QA) — reuses the exact same validity check
// rather than a separate one, so the two status sources can never silently drift apart.
function readNullableStatus(value: unknown): number | null {
  return isBunnyStreamWebhookStatus(value) ? value : null;
}

function readNullableEncodeProgress(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) {
    return null;
  }

  return value;
}

// Bunny's real wire shape is a comma-separated string (e.g. "360p,480p,720p"), not an array —
// confirmed against the real API. Parsed into a clean internal list; an empty/whitespace-only
// string or a missing field both resolve to `null` ("no resolutions reported"), never `[]`, so a
// caller's `Array.isArray(...) && .length > 0` check needs no separate empty-string special case.
function readNullableResolutionList(value: unknown): string[] | null {
  if (typeof value !== 'string') {
    return null;
  }

  const resolutions = value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  return resolutions.length > 0 ? resolutions : null;
}

// Bunny's `transcodingMessages` is an array of diagnostic entries when present; any non-empty array
// is treated as a failure/warning signal worth blocking a READY promotion over — this is
// deliberately conservative (a promotion is prevented, never caused, by this field), consistent with
// `ProviderVideoMetadata.hasFailureIndication`'s own contract.
function readHasFailureIndication(value: unknown): boolean | null {
  if (!Array.isArray(value)) {
    return null;
  }

  return value.length > 0;
}
