import { createAuthHttpConfig } from './auth-http.config';

describe('createAuthHttpConfig', () => {
  it('uses local development defaults without wildcard origins', () => {
    const config = createAuthHttpConfig({ NODE_ENV: 'development' });

    expect(config.trustedWebOrigins).toEqual(['http://localhost:3000', 'http://127.0.0.1:3000']);
    expect(config.cookies).toMatchObject({
      refreshTokenName: 'edvora_refresh',
      sessionIdName: 'edvora_session',
      path: '/auth',
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
    });
  });

  it('requires explicit production origins and secure cookies', () => {
    expect(() => createAuthHttpConfig({ NODE_ENV: 'production' })).toThrow(
      'AUTH_WEB_ORIGINS is required in production.',
    );

    expect(() =>
      createAuthHttpConfig({
        NODE_ENV: 'production',
        AUTH_WEB_ORIGINS: 'https://dashboard.edvora.example',
        AUTH_REFRESH_COOKIE_SECURE: 'false',
      }),
    ).toThrow('AUTH_REFRESH_COOKIE_SECURE cannot be false in production.');

    const config = createAuthHttpConfig({
      NODE_ENV: 'production',
      AUTH_WEB_ORIGINS: 'https://dashboard.edvora.example',
    });
    expect(config.cookies.secure).toBe(true);
  });

  it('rejects wildcard, path-based, and insecure SameSite=None configuration', () => {
    expect(() => createAuthHttpConfig({ AUTH_WEB_ORIGINS: '*' })).toThrow(
      'AUTH_WEB_ORIGINS must not contain wildcard origins.',
    );
    expect(() => createAuthHttpConfig({ AUTH_WEB_ORIGINS: 'http://localhost:3000/path' })).toThrow(
      'AUTH_WEB_ORIGINS entries must be exact HTTP(S) origins without paths.',
    );
    expect(() =>
      createAuthHttpConfig({
        AUTH_WEB_ORIGINS: 'http://localhost:3000',
        AUTH_REFRESH_COOKIE_SAMESITE: 'none',
      }),
    ).toThrow('AUTH_REFRESH_COOKIE_SAMESITE=none requires Secure cookies.');
  });
});
