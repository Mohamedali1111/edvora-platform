import { HttpStatus, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import * as cookieParser from 'cookie-parser';
import * as request from 'supertest';
import type { App } from 'supertest/types';
import { PlatformRole } from '../../../.generated/prisma/client';
import { ApiExceptionFilter } from '../../infrastructure/http/api-exception.filter';
import { AuthController } from './auth.controller';
import { AUTH_HTTP_CONFIG } from './http/auth-http.constants';
import { AuthCookieService } from './http/auth-cookie.service';
import { AccessTokenGuard } from './http/access-token.guard';
import { TrustedOriginGuard } from './http/trusted-origin.guard';
import { AuthOrchestrationService } from './services/auth-orchestration.service';
import { AccessTokenService } from './services/access-token.service';
import { ClockService } from './services/clock.service';
import { InvalidCredentialsError, InvalidRefreshSessionError } from './errors/auth.errors';

const trustedOrigin = 'http://localhost:3000';
const sessionId = '10000000-0000-7000-8000-000000000001';
const userId = '10000000-0000-7000-8000-000000000002';
const accessToken = 'access-token';
const refreshToken = 'refresh-token';

type AuthMock = {
  login: jest.Mock;
  refreshAuthenticatedSession: jest.Mock;
  logout: jest.Mock;
  logoutAll: jest.Mock;
  activateAccount: jest.Mock;
  changePassword: jest.Mock;
  completePasswordReset: jest.Mock;
};

type TestSessionResult = {
  user: { userId: string; platformRole: PlatformRole };
  sessionId: string;
  accessToken: string;
  refreshToken: string;
  accessTokenTtlSeconds: number;
  refreshTokenExpiresAt: Date;
};

describe('AuthController', () => {
  let app: INestApplication;
  let server: App;
  let auth: AuthMock;
  let accessTokens: { verify: jest.Mock };

  beforeEach(async () => {
    auth = createAuthMock();
    accessTokens = {
      verify: jest.fn().mockResolvedValue({
        sub: userId,
        sid: sessionId,
        role: PlatformRole.STUDENT,
        iat: 1,
        exp: 2,
        iss: 'edvora-api-test',
        aud: 'edvora-test-clients',
      }),
    };

    const moduleRef = await Test.createTestingModule({
      imports: [
        ThrottlerModule.forRoot([
          {
            name: 'auth',
            ttl: 60_000,
            limit: 60,
          },
        ]),
      ],
      controllers: [AuthController],
      providers: [
        AccessTokenGuard,
        AuthCookieService,
        ClockService,
        TrustedOriginGuard,
        {
          provide: AuthOrchestrationService,
          useValue: auth,
        },
        {
          provide: AccessTokenService,
          useValue: accessTokens,
        },
        {
          provide: AUTH_HTTP_CONFIG,
          useValue: {
            trustedWebOrigins: [trustedOrigin],
            cookies: {
              refreshTokenName: 'edvora_refresh',
              sessionIdName: 'edvora_session',
              path: '/auth',
              httpOnly: true,
              secure: false,
              sameSite: 'lax',
            },
          },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
        forbidUnknownValues: true,
      }),
    );
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.init();
    server = app.getHttpServer() as App;
  });

  afterEach(async () => {
    await app.close();
  });

  it('logs in web users with HttpOnly refresh cookies and no raw refresh token in JSON', async () => {
    auth.login.mockResolvedValue(createSessionResult());

    const response = await request(server)
      .post('/auth/login')
      .set('Origin', trustedOrigin)
      .send({
        email: 'user@example.test',
        password: 'correct horse battery staple',
        channel: 'WEB',
      })
      .expect(HttpStatus.OK);

    expect(auth.login).toHaveBeenCalledWith({
      email: 'user@example.test',
      password: 'correct horse battery staple',
      channel: 'WEB',
    });
    const body = responseBody(response);
    expect(body).toMatchObject({
      accessToken,
      sessionId,
      user: {
        id: userId,
        role: PlatformRole.STUDENT,
      },
    });
    expect(body.refreshToken).toBeUndefined();
    expect(response.headers['cache-control']).toBe('no-store');
    expect(setCookieHeaders(response)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('edvora_refresh=refresh-token;'),
        expect.stringContaining('edvora_session=10000000-0000-7000-8000-000000000001;'),
      ]),
    );
    const cookieHeaders = setCookieHeaders(response).join('\n');
    expect(cookieHeaders).toContain('HttpOnly');
    expect(cookieHeaders).toContain('SameSite=Lax');
    expect(cookieHeaders).toContain('Path=/auth');
    expect(cookieHeaders).toContain('Max-Age=');
    expect(cookieHeaders).not.toContain('Max-Age=0;');
  });

  it('logs in mobile users with body refresh token and no web refresh cookie', async () => {
    auth.login.mockResolvedValue(createSessionResult());

    const response = await request(server)
      .post('/auth/login')
      .send({
        email: 'user@example.test',
        password: 'correct horse battery staple',
        channel: 'MOBILE',
      })
      .expect(HttpStatus.OK);

    const body = responseBody(response);
    expect(body).toMatchObject({
      accessToken,
      refreshToken,
      sessionId,
    });
    expect(typeof body.refreshTokenExpiresAt).toBe('string');
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('maps nonexistent and wrong-password login to the same public error', async () => {
    auth.login.mockRejectedValue(new InvalidCredentialsError());

    const wrongPassword = await request(server)
      .post('/auth/login')
      .send({
        email: 'user@example.test',
        password: 'wrong password value',
        channel: 'MOBILE',
      })
      .expect(HttpStatus.UNAUTHORIZED);
    const missingUser = await request(server)
      .post('/auth/login')
      .send({
        email: 'missing@example.test',
        password: 'wrong password value',
        channel: 'MOBILE',
      })
      .expect(HttpStatus.UNAUTHORIZED);

    expect(wrongPassword.body).toEqual(missingUser.body);
    expect(wrongPassword.body).toEqual({
      error: {
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid credentials.',
      },
    });
    expect(wrongPassword.headers['cache-control']).toBe('no-store');
    expect(missingUser.headers['cache-control']).toBe('no-store');
  });

  it('rejects malformed login input and unsupported channels', async () => {
    await request(server)
      .post('/auth/login')
      .send({
        email: 'not-an-email',
        password: '',
        channel: 'DESKTOP',
      })
      .expect(HttpStatus.BAD_REQUEST)
      .expect({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Request validation failed.',
        },
      });
  });

  it('refreshes web sessions only through cookies and rotates the cookie value', async () => {
    auth.refreshAuthenticatedSession.mockResolvedValue(createSessionResult({ refreshToken: 'rotated-token' }));

    const response = await request(server)
      .post('/auth/refresh')
      .set('Origin', trustedOrigin)
      .set('Cookie', [`edvora_refresh=${refreshToken}`, `edvora_session=${sessionId}`])
      .send({ channel: 'WEB' })
      .expect(HttpStatus.OK);

    expect(auth.refreshAuthenticatedSession).toHaveBeenCalledWith({ sessionId, refreshToken });
    expect(responseBody(response).refreshToken).toBeUndefined();
    expect(setCookieHeaders(response).join('\n')).toContain('edvora_refresh=rotated-token;');
  });

  it('refreshes mobile sessions through explicit body input and rejects cross-transport misuse', async () => {
    auth.refreshAuthenticatedSession.mockResolvedValue(createSessionResult());

    const mobile = await request(server)
      .post('/auth/refresh')
      .send({ channel: 'MOBILE', sessionId, refreshToken })
      .expect(HttpStatus.OK);
    expect(responseBody(mobile).refreshToken).toBe(refreshToken);
    expect(mobile.headers['set-cookie']).toBeUndefined();

    await request(server)
      .post('/auth/refresh')
      .set('Origin', trustedOrigin)
      .set('Cookie', [`edvora_refresh=${refreshToken}`, `edvora_session=${sessionId}`])
      .send({ channel: 'WEB', sessionId, refreshToken })
      .expect(HttpStatus.BAD_REQUEST)
      .expect({
        error: {
          code: 'INVALID_AUTH_TRANSPORT',
          message: 'Invalid authentication transport.',
        },
      });
  });

  it('clears web cookies on refresh failure', async () => {
    auth.refreshAuthenticatedSession.mockRejectedValue(new InvalidRefreshSessionError());

    const response = await request(server)
      .post('/auth/refresh')
      .set('Origin', trustedOrigin)
      .set('Cookie', [`edvora_refresh=${refreshToken}`, `edvora_session=${sessionId}`])
      .send({ channel: 'WEB' })
      .expect(HttpStatus.UNAUTHORIZED);

    expect(errorCode(response)).toBe('INVALID_REFRESH_SESSION');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(setCookieHeaders(response).join('\n')).toContain('edvora_refresh=;');
    expect(setCookieHeaders(response).join('\n')).toContain('edvora_session=;');
  });

  it('authenticates protected routes with strict Bearer access tokens', async () => {
    auth.changePassword.mockResolvedValue(createSessionResult({ refreshToken: 'changed-refresh' }));

    await request(server)
      .post('/auth/password/change')
      .set('Origin', trustedOrigin)
      .send({ currentPassword: 'old password value', newPassword: 'new password value' })
      .expect(HttpStatus.UNAUTHORIZED);

    await request(server)
      .post('/auth/password/change')
      .set('Origin', trustedOrigin)
      .set('Authorization', 'Token malformed')
      .send({ currentPassword: 'old password value', newPassword: 'new password value' })
      .expect(HttpStatus.UNAUTHORIZED);

    const response = await request(server)
      .post('/auth/password/change')
      .set('Origin', trustedOrigin)
      .set('Authorization', 'Bearer verified-access')
      .send({ currentPassword: 'old password value', newPassword: 'new password value' })
      .expect(HttpStatus.OK);

    expect(accessTokens.verify).toHaveBeenCalledWith('verified-access');
    expect(auth.changePassword).toHaveBeenCalledWith({
      userId,
      currentSessionId: sessionId,
      currentPassword: 'old password value',
      newPassword: 'new password value',
    });
    expect(responseBody(response).refreshToken).toBeUndefined();
    expect(setCookieHeaders(response).join('\n')).toContain('edvora_refresh=changed-refresh;');
  });

  it('prevents body fields from overriding authenticated user/session values', async () => {
    await request(server)
      .post('/auth/password/change')
      .set('Origin', trustedOrigin)
      .set('Authorization', 'Bearer verified-access')
      .send({
        userId: 'attacker-user-id',
        sessionId: 'attacker-session-id',
        currentPassword: 'old password value',
        newPassword: 'new password value',
      })
      .expect(HttpStatus.BAD_REQUEST);

    expect(auth.changePassword).not.toHaveBeenCalled();
  });

  it('logs out only the authenticated session and clears web cookies', async () => {
    auth.logout.mockResolvedValue(undefined);
    auth.logoutAll.mockResolvedValue(1);

    const logout = await request(server)
      .post('/auth/logout')
      .set('Origin', trustedOrigin)
      .set('Authorization', 'Bearer verified-access')
      .set('Cookie', [`edvora_refresh=${refreshToken}`, `edvora_session=${sessionId}`])
      .send({ sessionId: 'other-session' })
      .expect(HttpStatus.NO_CONTENT);
    expect(auth.logout).toHaveBeenCalledWith({ userId, sessionId });
    expect(setCookieHeaders(logout).join('\n')).toContain('edvora_refresh=;');

    await request(server)
      .post('/auth/logout-all')
      .set('Origin', trustedOrigin)
      .set('Authorization', 'Bearer verified-access')
      .set('Cookie', [`edvora_refresh=${refreshToken}`, `edvora_session=${sessionId}`])
      .expect(HttpStatus.NO_CONTENT);
    expect(auth.logoutAll).toHaveBeenCalledWith({ userId });
  });

  it('completes activation and password reset without issuing tokens', async () => {
    auth.activateAccount.mockResolvedValue({ userId, platformRole: PlatformRole.STUDENT });
    auth.completePasswordReset.mockResolvedValue({ userId });

    await request(server)
      .post('/auth/activate')
      .send({
        activationToken: 'activation-token',
        purpose: 'STUDENT_ACTIVATION',
        newPassword: 'new activation password',
      })
      .expect(HttpStatus.NO_CONTENT);
    expect(auth.activateAccount).toHaveBeenCalledWith({
      activationToken: 'activation-token',
      expectedPurpose: 'STUDENT_ACTIVATION',
      newPassword: 'new activation password',
    });

    const reset = await request(server)
      .post('/auth/password/reset/complete')
      .set('Origin', trustedOrigin)
      .set('Cookie', [`edvora_refresh=${refreshToken}`, `edvora_session=${sessionId}`])
      .send({ resetToken: 'reset-token', newPassword: 'new reset password' })
      .expect(HttpStatus.NO_CONTENT);
    expect(reset.body).toEqual({});
    expect(setCookieHeaders(reset).join('\n')).toContain('edvora_refresh=;');
  });

  it('enforces trusted Origin on web cookie/channel requests without blocking mobile refresh', async () => {
    auth.refreshAuthenticatedSession.mockResolvedValue(createSessionResult());

    await request(server)
      .post('/auth/refresh')
      .set('Cookie', [`edvora_refresh=${refreshToken}`, `edvora_session=${sessionId}`])
      .send({ channel: 'WEB' })
      .expect(HttpStatus.FORBIDDEN)
      .expect({
        error: {
          code: 'CSRF_ORIGIN_INVALID',
          message: 'Origin is not allowed for this authentication request.',
        },
      });

    await request(server)
      .post('/auth/refresh')
      .set('Origin', 'https://attacker.example')
      .set('Cookie', [`edvora_refresh=${refreshToken}`, `edvora_session=${sessionId}`])
      .send({ channel: 'WEB' })
      .expect(HttpStatus.FORBIDDEN);

    await request(server)
      .post('/auth/refresh')
      .send({ channel: 'MOBILE', sessionId, refreshToken })
      .expect(HttpStatus.OK);
  });

  it('rate limits abuse-sensitive auth routes without permanent lockout semantics', async () => {
    auth.activateAccount.mockResolvedValue({ userId, platformRole: PlatformRole.STUDENT });

    for (let index = 0; index < 5; index += 1) {
      await request(server)
        .post('/auth/activate')
        .send({
          activationToken: `activation-token-${index}`,
          purpose: 'STUDENT_ACTIVATION',
          newPassword: 'new activation password',
        })
        .expect(HttpStatus.NO_CONTENT);
    }

    await request(server)
      .post('/auth/activate')
      .send({
        activationToken: 'activation-token-over-limit',
        purpose: 'STUDENT_ACTIVATION',
        newPassword: 'new activation password',
      })
      .expect(HttpStatus.TOO_MANY_REQUESTS)
      .expect({
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many requests.',
        },
      });
  });
});

function createAuthMock(): AuthMock {
  return {
    login: jest.fn(),
    refreshAuthenticatedSession: jest.fn(),
    logout: jest.fn(),
    logoutAll: jest.fn(),
    activateAccount: jest.fn(),
    changePassword: jest.fn(),
    completePasswordReset: jest.fn(),
  };
}

function createSessionResult(
  overrides: Partial<TestSessionResult> = {},
): TestSessionResult {
  return {
    user: { userId, platformRole: PlatformRole.STUDENT },
    sessionId,
    accessToken,
    refreshToken,
    accessTokenTtlSeconds: 600,
    refreshTokenExpiresAt: new Date(Date.now() + 10 * 60 * 60 * 1_000),
    ...overrides,
  };
}

function setCookieHeaders(response: request.Response): string[] {
  const header = response.headers['set-cookie'];

  if (!header) {
    return [];
  }

  return Array.isArray(header) ? header : [header];
}

function responseBody(response: request.Response): Record<string, unknown> {
  return response.body as unknown as Record<string, unknown>;
}

function errorCode(response: request.Response): string | undefined {
  const body = responseBody(response);
  const error = body.error as { code?: unknown } | undefined;

  return typeof error?.code === 'string' ? error.code : undefined;
}
