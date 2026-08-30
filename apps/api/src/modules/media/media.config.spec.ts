import { createMediaRuntimeConfig } from './media.config';

// A complete, valid environment for every Media config value. Individual tests override exactly
// the field(s) under test so each assertion is unambiguous about what it is checking.
const VALID_ENV: NodeJS.ProcessEnv = {
  MEDIA_DOCUMENTS_R2_ACCOUNT_ID: 'my-account-id',
  MEDIA_DOCUMENTS_R2_ACCESS_KEY_ID: 'real-access-key-id',
  MEDIA_DOCUMENTS_R2_SECRET_ACCESS_KEY: 'real-secret-access-key',
  MEDIA_DOCUMENTS_R2_BUCKET_NAME: 'edvora-documents',
  MEDIA_VIDEO_BUNNY_STREAM_LIBRARY_ID: '123456',
  MEDIA_VIDEO_BUNNY_STREAM_API_KEY: 'real-bunny-api-key',
  MEDIA_VIDEO_BUNNY_STREAM_WEBHOOK_SIGNING_SECRET: 'real-webhook-signing-secret',
  MEDIA_VIDEO_BUNNY_STREAM_CDN_HOSTNAME: 'vz-real-library.b-cdn.net',
  MEDIA_VIDEO_BUNNY_STREAM_TOKEN_AUTHENTICATION_KEY: 'real-token-authentication-key',
};

describe('createMediaRuntimeConfig', () => {
  it('loads a complete, correctly-typed config from a valid environment', () => {
    const config = createMediaRuntimeConfig(VALID_ENV);

    expect(config).toEqual({
      documents: {
        r2: {
          endpoint: 'https://my-account-id.r2.cloudflarestorage.com',
          accessKeyId: 'real-access-key-id',
          secretAccessKey: 'real-secret-access-key',
          bucketName: 'edvora-documents',
          uploadUrlTtlSeconds: 600,
          downloadUrlTtlSeconds: 300,
        },
      },
      video: {
        bunnyStream: {
          libraryId: '123456',
          apiKey: 'real-bunny-api-key',
          webhookSigningSecret: 'real-webhook-signing-secret',
          tusUploadUrl: 'https://video.bunnycdn.com/tusupload',
          tusAuthorizationTtlSeconds: 21_600,
          cdnHostname: 'vz-real-library.b-cdn.net',
          tokenAuthenticationKey: 'real-token-authentication-key',
        },
      },
    });
  });

  // -----------------------------------------------------------------------------------------------
  // Required values / placeholder rejection — every secret, and every non-secret value critical
  // enough that leaving the repository's own `.env.example` value in place must fail loudly rather
  // than silently booting against nonexistent infrastructure.
  // -----------------------------------------------------------------------------------------------

  it.each([
    'MEDIA_DOCUMENTS_R2_ACCESS_KEY_ID',
    'MEDIA_DOCUMENTS_R2_SECRET_ACCESS_KEY',
    'MEDIA_DOCUMENTS_R2_BUCKET_NAME',
    'MEDIA_VIDEO_BUNNY_STREAM_API_KEY',
    'MEDIA_VIDEO_BUNNY_STREAM_WEBHOOK_SIGNING_SECRET',
    'MEDIA_VIDEO_BUNNY_STREAM_CDN_HOSTNAME',
    'MEDIA_VIDEO_BUNNY_STREAM_TOKEN_AUTHENTICATION_KEY',
  ] as const)('rejects a missing %s', (name) => {
    const env = { ...VALID_ENV, [name]: undefined };
    expect(() => createMediaRuntimeConfig(env)).toThrow(new RegExp(`${name}.*required`));
  });

  it.each([
    'MEDIA_DOCUMENTS_R2_ACCESS_KEY_ID',
    'MEDIA_DOCUMENTS_R2_SECRET_ACCESS_KEY',
    'MEDIA_DOCUMENTS_R2_BUCKET_NAME',
    'MEDIA_VIDEO_BUNNY_STREAM_API_KEY',
    'MEDIA_VIDEO_BUNNY_STREAM_WEBHOOK_SIGNING_SECRET',
    'MEDIA_VIDEO_BUNNY_STREAM_CDN_HOSTNAME',
    'MEDIA_VIDEO_BUNNY_STREAM_TOKEN_AUTHENTICATION_KEY',
  ] as const)('rejects the repository .env.example placeholder value left in %s', (name) => {
    const env = { ...VALID_ENV, [name]: 'replace-with-something' };
    expect(() => createMediaRuntimeConfig(env)).toThrow('must be a real value, not an example placeholder.');
  });

  it('rejects a value merely containing the word "placeholder", not only the replace- prefix', () => {
    const env = { ...VALID_ENV, MEDIA_VIDEO_BUNNY_STREAM_API_KEY: 'my-placeholder-key' };
    expect(() => createMediaRuntimeConfig(env)).toThrow('must be a real value, not an example placeholder.');
  });

  // -----------------------------------------------------------------------------------------------
  // R2 endpoint resolution
  // -----------------------------------------------------------------------------------------------

  it('derives the R2 endpoint from the account ID when no explicit endpoint is given', () => {
    const config = createMediaRuntimeConfig(VALID_ENV);
    expect(config.documents.r2.endpoint).toBe('https://my-account-id.r2.cloudflarestorage.com');
  });

  it('prefers an explicit R2 endpoint over the account ID when both are given', () => {
    const env = { ...VALID_ENV, MEDIA_DOCUMENTS_R2_ENDPOINT: 'https://custom.example-r2.com' };
    const config = createMediaRuntimeConfig(env);
    expect(config.documents.r2.endpoint).toBe('https://custom.example-r2.com');
  });

  it('rejects a non-HTTPS explicit R2 endpoint', () => {
    const env = { ...VALID_ENV, MEDIA_DOCUMENTS_R2_ENDPOINT: 'http://insecure.example.com' };
    expect(() => createMediaRuntimeConfig(env)).toThrow('MEDIA_DOCUMENTS_R2_ENDPOINT must be a valid HTTPS URL.');
  });

  it('rejects when neither R2 endpoint nor account ID is given', () => {
    const env = { ...VALID_ENV, MEDIA_DOCUMENTS_R2_ACCOUNT_ID: undefined };
    expect(() => createMediaRuntimeConfig(env)).toThrow(
      'MEDIA_DOCUMENTS_R2_ENDPOINT or MEDIA_DOCUMENTS_R2_ACCOUNT_ID is required',
    );
  });

  it('rejects an R2 account ID containing characters outside letters/digits/underscore/hyphen', () => {
    const env = { ...VALID_ENV, MEDIA_DOCUMENTS_R2_ACCOUNT_ID: 'not a valid id!' };
    expect(() => createMediaRuntimeConfig(env)).toThrow(
      'MEDIA_DOCUMENTS_R2_ACCOUNT_ID may only contain letters, numbers, underscores, and hyphens.',
    );
  });

  // -----------------------------------------------------------------------------------------------
  // Bunny library ID / CDN hostname / TUS URL shape validation
  // -----------------------------------------------------------------------------------------------

  it.each(['0', '-5', '12a', 'abc', '007'])(
    'rejects a Bunny library ID that is not a plain positive integer string: %s',
    (libraryId) => {
      const env = { ...VALID_ENV, MEDIA_VIDEO_BUNNY_STREAM_LIBRARY_ID: libraryId };
      expect(() => createMediaRuntimeConfig(env)).toThrow(
        'MEDIA_VIDEO_BUNNY_STREAM_LIBRARY_ID must be a positive integer string.',
      );
    },
  );

  it.each(['https://vz-x.b-cdn.net/some/path', 'not a hostname', 'vz-x.b-cdn.net/', 'a..b.b-cdn.net'])(
    'rejects a Bunny CDN hostname that is not a bare hostname: %s',
    (hostname) => {
      const env = { ...VALID_ENV, MEDIA_VIDEO_BUNNY_STREAM_CDN_HOSTNAME: hostname };
      expect(() => createMediaRuntimeConfig(env)).toThrow(
        'MEDIA_VIDEO_BUNNY_STREAM_CDN_HOSTNAME must be a bare hostname, with no protocol, path, or query.',
      );
    },
  );

  it('defaults the Bunny TUS upload URL when not explicitly configured', () => {
    const config = createMediaRuntimeConfig(VALID_ENV);
    expect(config.video.bunnyStream.tusUploadUrl).toBe('https://video.bunnycdn.com/tusupload');
  });

  it('rejects a non-HTTPS explicit Bunny TUS upload URL', () => {
    const env = { ...VALID_ENV, MEDIA_VIDEO_BUNNY_STREAM_TUS_UPLOAD_URL: 'http://video.bunnycdn.com/tusupload' };
    expect(() => createMediaRuntimeConfig(env)).toThrow(
      'MEDIA_VIDEO_BUNNY_STREAM_TUS_UPLOAD_URL must be a valid HTTPS URL.',
    );
  });

  // -----------------------------------------------------------------------------------------------
  // TTL bounds — every bounded TTL rejects out-of-range/non-integer values and applies its
  // documented default when unset.
  // -----------------------------------------------------------------------------------------------

  it('applies documented TTL defaults when unset', () => {
    const config = createMediaRuntimeConfig(VALID_ENV);
    expect(config.documents.r2.uploadUrlTtlSeconds).toBe(600);
    expect(config.documents.r2.downloadUrlTtlSeconds).toBe(300);
    expect(config.video.bunnyStream.tusAuthorizationTtlSeconds).toBe(21_600);
  });

  it.each([
    ['MEDIA_DOCUMENTS_R2_UPLOAD_URL_TTL_SECONDS', '59', 60, 1800],
    ['MEDIA_DOCUMENTS_R2_UPLOAD_URL_TTL_SECONDS', '1801', 60, 1800],
    ['MEDIA_DOCUMENTS_R2_DOWNLOAD_URL_TTL_SECONDS', '59', 60, 900],
    ['MEDIA_DOCUMENTS_R2_DOWNLOAD_URL_TTL_SECONDS', '901', 60, 900],
    ['MEDIA_VIDEO_BUNNY_STREAM_TUS_AUTHORIZATION_TTL_SECONDS', '299', 300, 86_400],
    ['MEDIA_VIDEO_BUNNY_STREAM_TUS_AUTHORIZATION_TTL_SECONDS', '86401', 300, 86_400],
  ] as const)('rejects %s=%s outside its bounded range', (name, value, min, max) => {
    const env = { ...VALID_ENV, [name]: value };
    expect(() => createMediaRuntimeConfig(env)).toThrow(
      `${name} must be an integer number of seconds between ${min} and ${max}.`,
    );
  });

  it('rejects a non-integer TTL value', () => {
    const env = { ...VALID_ENV, MEDIA_DOCUMENTS_R2_UPLOAD_URL_TTL_SECONDS: 'soon' };
    expect(() => createMediaRuntimeConfig(env)).toThrow(
      'MEDIA_DOCUMENTS_R2_UPLOAD_URL_TTL_SECONDS must be an integer number of seconds between 60 and 1800.',
    );
  });

  it('accepts TTL values exactly at their documented bounds', () => {
    const env = {
      ...VALID_ENV,
      MEDIA_DOCUMENTS_R2_UPLOAD_URL_TTL_SECONDS: '60',
      MEDIA_DOCUMENTS_R2_DOWNLOAD_URL_TTL_SECONDS: '900',
    };
    const config = createMediaRuntimeConfig(env);
    expect(config.documents.r2.uploadUrlTtlSeconds).toBe(60);
    expect(config.documents.r2.downloadUrlTtlSeconds).toBe(900);
  });
});
