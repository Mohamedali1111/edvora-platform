const DEFAULT_DOCUMENT_UPLOAD_TTL_SECONDS = 10 * 60;
const DEFAULT_DOCUMENT_DOWNLOAD_TTL_SECONDS = 5 * 60;
const MIN_DOCUMENT_UPLOAD_TTL_SECONDS = 60;
const MAX_DOCUMENT_UPLOAD_TTL_SECONDS = 30 * 60;
const MIN_DOCUMENT_DOWNLOAD_TTL_SECONDS = 60;
const MAX_DOCUMENT_DOWNLOAD_TTL_SECONDS = 15 * 60;

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
        bucketName: readRequiredValue(env.MEDIA_DOCUMENTS_R2_BUCKET_NAME, 'MEDIA_DOCUMENTS_R2_BUCKET_NAME'),
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
  const secret = readRequiredValue(value, name);

  if (secret.startsWith('replace-') || secret.includes('placeholder')) {
    throw new Error(`${name} must be a real value, not an example placeholder.`);
  }

  return secret;
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
