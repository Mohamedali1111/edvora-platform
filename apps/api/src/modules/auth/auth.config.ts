const DEFAULT_ACCESS_TOKEN_TTL_SECONDS = 10 * 60;
const DEFAULT_MOBILE_REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60;
const DEFAULT_WEB_REFRESH_TTL_SECONDS = 10 * 60 * 60;
const DEFAULT_ACTIVATION_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;
const DEFAULT_PASSWORD_RESET_TOKEN_TTL_SECONDS = 60 * 60;
const MIN_HS256_SECRET_BYTES = 32;

export type PasswordPolicyConfig = {
  minLength: number;
  maxLength: number;
};

export type Argon2idConfig = {
  memoryCostKiB: number;
  timeCost: number;
  parallelism: number;
};

export type AuthRuntimeConfig = {
  jwt: {
    secret: string;
    issuer: string;
    audience: string;
    accessTokenTtlSeconds: number;
  };
  refreshSessionTtlSeconds: {
    mobile: number;
    web: number;
  };
  oneTimeTokenTtlSeconds: {
    activation: number;
    passwordReset: number;
  };
  passwordPolicy: PasswordPolicyConfig;
  argon2id: Argon2idConfig;
};

export const DEFAULT_PASSWORD_POLICY: PasswordPolicyConfig = {
  minLength: 12,
  maxLength: 128,
};

export const DEFAULT_ARGON2ID_CONFIG: Argon2idConfig = {
  memoryCostKiB: 19 * 1024,
  timeCost: 2,
  parallelism: 1,
};

export function createAuthRuntimeConfig(env: NodeJS.ProcessEnv = process.env): AuthRuntimeConfig {
  return {
    jwt: {
      secret: readJwtSecret(env.AUTH_JWT_SECRET),
      issuer: readRequiredValue(env.AUTH_JWT_ISSUER, 'AUTH_JWT_ISSUER'),
      audience: readRequiredValue(env.AUTH_JWT_AUDIENCE, 'AUTH_JWT_AUDIENCE'),
      accessTokenTtlSeconds: readPositiveInteger(
        env.AUTH_ACCESS_TOKEN_TTL_SECONDS,
        'AUTH_ACCESS_TOKEN_TTL_SECONDS',
        DEFAULT_ACCESS_TOKEN_TTL_SECONDS,
      ),
    },
    refreshSessionTtlSeconds: {
      mobile: DEFAULT_MOBILE_REFRESH_TTL_SECONDS,
      web: DEFAULT_WEB_REFRESH_TTL_SECONDS,
    },
    oneTimeTokenTtlSeconds: {
      activation: DEFAULT_ACTIVATION_TOKEN_TTL_SECONDS,
      passwordReset: DEFAULT_PASSWORD_RESET_TOKEN_TTL_SECONDS,
    },
    passwordPolicy: DEFAULT_PASSWORD_POLICY,
    argon2id: DEFAULT_ARGON2ID_CONFIG,
  };
}

function readRequiredValue(value: string | undefined, name: string): string {
  const trimmed = value?.trim();

  if (!trimmed) {
    throw new Error(`${name} is required for API authentication runtime.`);
  }

  return trimmed;
}

function readJwtSecret(value: string | undefined): string {
  const secret = readRequiredValue(value, 'AUTH_JWT_SECRET');

  if (secret.startsWith('replace-') || secret.includes('placeholder')) {
    throw new Error('AUTH_JWT_SECRET must be a real secret, not an example placeholder.');
  }

  if (Buffer.byteLength(secret, 'utf8') < MIN_HS256_SECRET_BYTES) {
    throw new Error('AUTH_JWT_SECRET must contain at least 32 bytes for HS256.');
  }

  return secret;
}

function readPositiveInteger(value: string | undefined, name: string, defaultValue: number): number {
  const trimmed = value?.trim();

  if (!trimmed) {
    return defaultValue;
  }

  const parsed = Number(trimmed);

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer number of seconds.`);
  }

  return parsed;
}
