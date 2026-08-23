import { createAuthRuntimeConfig } from './auth.config';

describe('createAuthRuntimeConfig', () => {
  it('requires a non-placeholder JWT secret with at least 32 bytes', () => {
    expect(() =>
      createAuthRuntimeConfig({
        AUTH_JWT_SECRET: 'short',
        AUTH_JWT_ISSUER: 'edvora-api',
        AUTH_JWT_AUDIENCE: 'edvora-clients',
      }),
    ).toThrow('AUTH_JWT_SECRET must contain at least 32 bytes for HS256.');

    expect(() =>
      createAuthRuntimeConfig({
        AUTH_JWT_SECRET: 'replace-with-at-least-32-random-bytes-base64url',
        AUTH_JWT_ISSUER: 'edvora-api',
        AUTH_JWT_AUDIENCE: 'edvora-clients',
      }),
    ).toThrow('AUTH_JWT_SECRET must be a real secret, not an example placeholder.');
  });

  it('loads typed auth configuration from environment variables', () => {
    const config = createAuthRuntimeConfig({
      AUTH_JWT_SECRET: '0123456789abcdef0123456789abcdef',
      AUTH_JWT_ISSUER: 'edvora-api',
      AUTH_JWT_AUDIENCE: 'edvora-clients',
      AUTH_ACCESS_TOKEN_TTL_SECONDS: '600',
    });

    expect(config.jwt.accessTokenTtlSeconds).toBe(600);
    expect(config.passwordPolicy).toEqual({ minLength: 12, maxLength: 128 });
    expect(config.argon2id).toEqual({
      memoryCostKiB: 19 * 1024,
      timeCost: 2,
      parallelism: 1,
    });
  });
});
