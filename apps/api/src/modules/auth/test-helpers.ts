import type { AuthRuntimeConfig } from './auth.config';

export const testAuthConfig: AuthRuntimeConfig = {
  jwt: {
    secret: '0123456789abcdef0123456789abcdef',
    issuer: 'edvora-api-test',
    audience: 'edvora-test-clients',
    accessTokenTtlSeconds: 600,
  },
  refreshSessionTtlSeconds: {
    mobile: 30 * 24 * 60 * 60,
    web: 10 * 60 * 60,
  },
  oneTimeTokenTtlSeconds: {
    activation: 7 * 24 * 60 * 60,
    passwordReset: 60 * 60,
  },
  passwordPolicy: {
    minLength: 12,
    maxLength: 128,
  },
  argon2id: {
    memoryCostKiB: 19 * 1024,
    timeCost: 2,
    parallelism: 1,
  },
};
