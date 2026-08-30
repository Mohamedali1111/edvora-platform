const DEFAULT_DOCUMENT_UPLOAD_TTL_SECONDS = 10 * 60;
const DEFAULT_DOCUMENT_DOWNLOAD_TTL_SECONDS = 5 * 60;
const DEFAULT_VIDEO_TUS_AUTH_TTL_SECONDS = 6 * 60 * 60;
const MIN_DOCUMENT_UPLOAD_TTL_SECONDS = 60;
const MAX_DOCUMENT_UPLOAD_TTL_SECONDS = 30 * 60;
const MIN_DOCUMENT_DOWNLOAD_TTL_SECONDS = 60;
const MAX_DOCUMENT_DOWNLOAD_TTL_SECONDS = 15 * 60;
const MIN_VIDEO_TUS_AUTH_TTL_SECONDS = 5 * 60;
const MAX_VIDEO_TUS_AUTH_TTL_SECONDS = 24 * 60 * 60;

export type MediaRuntimeConfig = {
  documents: {
    r2: {
      endpoint: string;
      accessKeyId: string;
      secretAccessKey: string;
      bucketName: string;
      uploadUrlTtlSeconds: number;
      downloadUrlTtlSeconds: number;
    };
  };
  video: {
    bunnyStream: {
      libraryId: string;
      apiKey: string;
      webhookSigningSecret: string;
      tusUploadUrl: string;
      tusAuthorizationTtlSeconds: number;
      cdnHostname: string;
      tokenAuthenticationKey: string;
    };
  };
};

export function createMediaRuntimeConfig(env: NodeJS.ProcessEnv = process.env): MediaRuntimeConfig {
  const endpoint = readR2Endpoint(env.MEDIA_DOCUMENTS_R2_ENDPOINT, env.MEDIA_DOCUMENTS_R2_ACCOUNT_ID);

  return {
    documents: {
      r2: {
        endpoint,
        accessKeyId: readSecretValue(env.MEDIA_DOCUMENTS_R2_ACCESS_KEY_ID, 'MEDIA_DOCUMENTS_R2_ACCESS_KEY_ID'),
        secretAccessKey: readSecretValue(
          env.MEDIA_DOCUMENTS_R2_SECRET_ACCESS_KEY,
          'MEDIA_DOCUMENTS_R2_SECRET_ACCESS_KEY',
        ),
        bucketName: readNonPlaceholderValue(env.MEDIA_DOCUMENTS_R2_BUCKET_NAME, 'MEDIA_DOCUMENTS_R2_BUCKET_NAME'),
        uploadUrlTtlSeconds: readBoundedTtlSeconds(
          env.MEDIA_DOCUMENTS_R2_UPLOAD_URL_TTL_SECONDS,
          'MEDIA_DOCUMENTS_R2_UPLOAD_URL_TTL_SECONDS',
          DEFAULT_DOCUMENT_UPLOAD_TTL_SECONDS,
          MIN_DOCUMENT_UPLOAD_TTL_SECONDS,
          MAX_DOCUMENT_UPLOAD_TTL_SECONDS,
        ),
        downloadUrlTtlSeconds: readBoundedTtlSeconds(
          env.MEDIA_DOCUMENTS_R2_DOWNLOAD_URL_TTL_SECONDS,
          'MEDIA_DOCUMENTS_R2_DOWNLOAD_URL_TTL_SECONDS',
          DEFAULT_DOCUMENT_DOWNLOAD_TTL_SECONDS,
          MIN_DOCUMENT_DOWNLOAD_TTL_SECONDS,
          MAX_DOCUMENT_DOWNLOAD_TTL_SECONDS,
        ),
      },
    },
    video: {
      bunnyStream: {
        libraryId: readBunnyLibraryId(env.MEDIA_VIDEO_BUNNY_STREAM_LIBRARY_ID),
        apiKey: readSecretValue(env.MEDIA_VIDEO_BUNNY_STREAM_API_KEY, 'MEDIA_VIDEO_BUNNY_STREAM_API_KEY'),
        webhookSigningSecret: readSecretValue(
          env.MEDIA_VIDEO_BUNNY_STREAM_WEBHOOK_SIGNING_SECRET,
          'MEDIA_VIDEO_BUNNY_STREAM_WEBHOOK_SIGNING_SECRET',
        ),
        tusUploadUrl: readHttpsUrl(
          env.MEDIA_VIDEO_BUNNY_STREAM_TUS_UPLOAD_URL?.trim() || 'https://video.bunnycdn.com/tusupload',
          'MEDIA_VIDEO_BUNNY_STREAM_TUS_UPLOAD_URL',
        ),
        tusAuthorizationTtlSeconds: readBoundedTtlSeconds(
          env.MEDIA_VIDEO_BUNNY_STREAM_TUS_AUTHORIZATION_TTL_SECONDS,
          'MEDIA_VIDEO_BUNNY_STREAM_TUS_AUTHORIZATION_TTL_SECONDS',
          DEFAULT_VIDEO_TUS_AUTH_TTL_SECONDS,
          MIN_VIDEO_TUS_AUTH_TTL_SECONDS,
          MAX_VIDEO_TUS_AUTH_TTL_SECONDS,
        ),
        cdnHostname: readBunnyCdnHostname(env.MEDIA_VIDEO_BUNNY_STREAM_CDN_HOSTNAME),
        tokenAuthenticationKey: readSecretValue(
          env.MEDIA_VIDEO_BUNNY_STREAM_TOKEN_AUTHENTICATION_KEY,
          'MEDIA_VIDEO_BUNNY_STREAM_TOKEN_AUTHENTICATION_KEY',
        ),
      },
    },
  };
}

function readR2Endpoint(endpointValue: string | undefined, accountIdValue: string | undefined): string {
  const explicitEndpoint = endpointValue?.trim();
  const accountId = accountIdValue?.trim();

  if (explicitEndpoint) {
    return readHttpsUrl(explicitEndpoint, 'MEDIA_DOCUMENTS_R2_ENDPOINT');
  }

  if (!accountId) {
    throw new Error('MEDIA_DOCUMENTS_R2_ENDPOINT or MEDIA_DOCUMENTS_R2_ACCOUNT_ID is required for document storage.');
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(accountId)) {
    throw new Error('MEDIA_DOCUMENTS_R2_ACCOUNT_ID may only contain letters, numbers, underscores, and hyphens.');
  }

  return `https://${accountId}.r2.cloudflarestorage.com`;
}

function readHttpsUrl(value: string, name: string): string {
  let parsed: URL;

  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid HTTPS URL.`);
  }

  if (parsed.protocol !== 'https:' || !parsed.hostname) {
    throw new Error(`${name} must be a valid HTTPS URL.`);
  }

  return value;
}

function readRequiredValue(value: string | undefined, name: string): string {
  const trimmed = value?.trim();

  if (!trimmed) {
    throw new Error(`${name} is required for document storage.`);
  }

  return trimmed;
}

function readSecretValue(value: string | undefined, name: string): string {
  return readNonPlaceholderValue(value, name);
}

// Rejects the repository's own `.env.example` convention (`replace-with-...`) so a config value
// that is not a secret but is still critical to get right — an R2 bucket name, a Bunny CDN
// hostname — cannot be silently carried into production unedited. A wrong-but-plausible-looking
// hostname/bucket name would not fail this validation (that is inherent to any string field); this
// only catches the concrete, common failure mode of the example placeholder being left in place.
function readNonPlaceholderValue(value: string | undefined, name: string): string {
  const trimmed = readRequiredValue(value, name);

  if (trimmed.startsWith('replace-') || trimmed.includes('placeholder')) {
    throw new Error(`${name} must be a real value, not an example placeholder.`);
  }

  return trimmed;
}

function readBunnyLibraryId(value: string | undefined): string {
  const libraryId = readRequiredValue(value, 'MEDIA_VIDEO_BUNNY_STREAM_LIBRARY_ID');

  if (!/^[1-9][0-9]*$/.test(libraryId)) {
    throw new Error('MEDIA_VIDEO_BUNNY_STREAM_LIBRARY_ID must be a positive integer string.');
  }

  return libraryId;
}

function readBunnyCdnHostname(value: string | undefined): string {
  const hostname = readNonPlaceholderValue(value, 'MEDIA_VIDEO_BUNNY_STREAM_CDN_HOSTNAME');

  if (!/^[a-zA-Z0-9.-]+$/.test(hostname) || hostname.includes('..') || hostname.includes('/')) {
    throw new Error('MEDIA_VIDEO_BUNNY_STREAM_CDN_HOSTNAME must be a bare hostname, with no protocol, path, or query.');
  }

  return hostname;
}

function readBoundedTtlSeconds(
  value: string | undefined,
  name: string,
  defaultValue: number,
  minValue: number,
  maxValue: number,
): number {
  const trimmed = value?.trim();

  if (!trimmed) {
    return defaultValue;
  }

  const parsed = Number(trimmed);

  if (
    !Number.isSafeInteger(parsed) ||
    parsed < minValue ||
    parsed > maxValue
  ) {
    throw new Error(`${name} must be an integer number of seconds between ${minValue} and ${maxValue}.`);
  }

  return parsed;
}
