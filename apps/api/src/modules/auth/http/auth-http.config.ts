import type { CookieOptions } from 'express';

export type AuthHttpConfig = {
  trustedWebOrigins: string[];
  cookies: {
    refreshTokenName: string;
    sessionIdName: string;
    path: string;
    httpOnly: true;
    secure: boolean;
    sameSite: CookieOptions['sameSite'];
  };
};

const DEFAULT_LOCAL_WEB_ORIGINS = ['http://localhost:3000', 'http://127.0.0.1:3000'];
const DEFAULT_REFRESH_COOKIE_NAME = 'edvora_refresh';
const DEFAULT_SESSION_COOKIE_NAME = 'edvora_session';
const DEFAULT_COOKIE_PATH = '/auth';

export function createAuthHttpConfig(env: NodeJS.ProcessEnv = process.env): AuthHttpConfig {
  const isProduction = env.NODE_ENV === 'production';
  const trustedWebOrigins = readTrustedOrigins(env.AUTH_WEB_ORIGINS, isProduction);
  const secure = readCookieSecure(env.AUTH_REFRESH_COOKIE_SECURE, isProduction);
  const sameSite = readSameSite(env.AUTH_REFRESH_COOKIE_SAMESITE, secure);

  return {
    trustedWebOrigins,
    cookies: {
      refreshTokenName: env.AUTH_REFRESH_COOKIE_NAME?.trim() || DEFAULT_REFRESH_COOKIE_NAME,
      sessionIdName: env.AUTH_SESSION_COOKIE_NAME?.trim() || DEFAULT_SESSION_COOKIE_NAME,
      path: env.AUTH_REFRESH_COOKIE_PATH?.trim() || DEFAULT_COOKIE_PATH,
      httpOnly: true,
      secure,
      sameSite,
    },
  };
}

function readTrustedOrigins(value: string | undefined, isProduction: boolean): string[] {
  const origins = (value ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (origins.some((origin) => origin === '*')) {
    throw new Error('AUTH_WEB_ORIGINS must not contain wildcard origins.');
  }

  if (origins.length === 0) {
    if (isProduction) {
      throw new Error('AUTH_WEB_ORIGINS is required in production.');
    }

    return DEFAULT_LOCAL_WEB_ORIGINS;
  }

  for (const origin of origins) {
    assertValidOrigin(origin);
  }

  return origins;
}

function assertValidOrigin(origin: string): void {
  let parsed: URL;

  try {
    parsed = new URL(origin);
  } catch {
    throw new Error('AUTH_WEB_ORIGINS must contain valid URL origins.');
  }

  if (parsed.origin !== origin || !['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('AUTH_WEB_ORIGINS entries must be exact HTTP(S) origins without paths.');
  }
}

function readCookieSecure(value: string | undefined, isProduction: boolean): boolean {
  const normalized = value?.trim().toLowerCase();

  if (!normalized) {
    return isProduction;
  }

  if (normalized === 'true') {
    return true;
  }

  if (normalized === 'false') {
    if (isProduction) {
      throw new Error('AUTH_REFRESH_COOKIE_SECURE cannot be false in production.');
    }

    return false;
  }

  throw new Error('AUTH_REFRESH_COOKIE_SECURE must be true or false when set.');
}

function readSameSite(value: string | undefined, secure: boolean): CookieOptions['sameSite'] {
  const normalized = value?.trim().toLowerCase() || 'lax';

  if (normalized === 'lax' || normalized === 'strict') {
    return normalized;
  }

  if (normalized === 'none') {
    if (!secure) {
      throw new Error('AUTH_REFRESH_COOKIE_SAMESITE=none requires Secure cookies.');
    }

    return 'none';
  }

  throw new Error('AUTH_REFRESH_COOKIE_SAMESITE must be lax, strict, or none.');
}
