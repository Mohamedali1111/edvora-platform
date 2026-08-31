import { HttpStatus, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as cookieParser from 'cookie-parser';
import * as request from 'supertest';
import type { App } from 'supertest/types';
import {
  AccountActivationPurpose,
  AccountStatus,
  CredentialType,
  LanguagePreference,
  PlatformRole,
  RefreshSessionStatus,
} from '../../../.generated/prisma/client';
import { DATABASE_RUNTIME_CONFIG } from '../../infrastructure/database/database.constants';
import type { DatabaseRuntimeConfig } from '../../infrastructure/database/database.config';
import { ApiExceptionFilter } from '../../infrastructure/http/api-exception.filter';
import { AuthModule } from './auth.module';
import { AUTH_RUNTIME_CONFIG } from './auth.constants';
import { AUTH_HTTP_CONFIG } from './http/auth-http.constants';
import { testAuthConfig } from './test-helpers';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { AccountActivationTokenService } from './services/account-activation-token.service';
import { PasswordResetTokenService } from './services/password-reset-token.service';
import { PasswordService } from './services/password.service';
import { UuidV7Service } from './services/uuid-v7.service';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const maybeDescribe = testDatabaseUrl ? describe : describe.skip;
const trustedOrigin = 'http://localhost:3000';

maybeDescribe('auth HTTP PostgreSQL integration', () => {
  let app: INestApplication;
  let server: App;
  let prisma: PrismaService;
  let activationTokens: AccountActivationTokenService;
  let resetTokens: PasswordResetTokenService;
  let passwordService: PasswordService;
  let uuid: UuidV7Service;

  const activationUserId = '20000000-0000-7000-8000-000000000001';
  const resetUserId = '20000000-0000-7000-8000-000000000002';
  const webUserId = '20000000-0000-7000-8000-000000000003';

  beforeEach(async () => {
    const databaseConfig: DatabaseRuntimeConfig = {
      databaseUrl: testDatabaseUrl as string,
      pool: {
        maxConnections: 4,
        connectionTimeoutMillis: 5_000,
        idleTimeoutMillis: 10_000,
      },
    };

    const moduleRef = await Test.createTestingModule({
      imports: [AuthModule],
    })
      .overrideProvider(DATABASE_RUNTIME_CONFIG)
      .useValue(databaseConfig)
      .overrideProvider(AUTH_RUNTIME_CONFIG)
      .useValue(testAuthConfig)
      .overrideProvider(AUTH_HTTP_CONFIG)
      .useValue({
        trustedWebOrigins: [trustedOrigin],
        cookies: {
          refreshTokenName: 'edvora_refresh',
          sessionIdName: 'edvora_session',
          path: '/auth',
          httpOnly: true,
          secure: false,
          sameSite: 'lax',
        },
      })
      .compile();

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

    prisma = moduleRef.get(PrismaService);
    activationTokens = moduleRef.get(AccountActivationTokenService);
    resetTokens = moduleRef.get(PasswordResetTokenService);
    passwordService = moduleRef.get(PasswordService);
    uuid = moduleRef.get(UuidV7Service);

    await clearAuthData();
  });

  afterEach(async () => {
    await app.close();
  });

  it('executes activate, login, refresh, password change, refresh, and logout without device authorization writes', async () => {
    await createUser(activationUserId, 'http-activation@example.test', PlatformRole.STUDENT);
    const activation = await activationTokens.issue({
      userId: activationUserId,
      purpose: AccountActivationPurpose.STUDENT_ACTIVATION,
    });

    await request(server)
      .post('/auth/activate')
      .send({
        activationToken: activation.rawToken,
        purpose: AccountActivationPurpose.STUDENT_ACTIVATION,
        newPassword: 'initial activated password',
      })
      .expect(HttpStatus.NO_CONTENT);

    const login = await request(server)
      .post('/auth/login')
      .send({
        email: 'HTTP-ACTIVATION@example.test',
        password: 'initial activated password',
        channel: 'MOBILE',
      })
      .expect(HttpStatus.OK);

    const loginBody = sessionBody(login);
    expect(loginBody.refreshToken).toEqual(expect.any(String));
    expect(loginBody.user).toEqual({ id: activationUserId, role: PlatformRole.STUDENT });

    const refreshed = await request(server)
      .post('/auth/refresh')
      .send({
        channel: 'MOBILE',
        sessionId: loginBody.sessionId,
        refreshToken: loginBody.refreshToken,
      })
      .expect(HttpStatus.OK);

    const changed = await request(server)
      .post('/auth/password/change')
      .set('Authorization', `Bearer ${sessionBody(refreshed).accessToken}`)
      .send({
        currentPassword: 'initial activated password',
        newPassword: 'changed password value',
      })
      .expect(HttpStatus.OK);

    await request(server)
      .post('/auth/refresh')
      .send({
        channel: 'MOBILE',
        sessionId: loginBody.sessionId,
        refreshToken: sessionBody(refreshed).refreshToken,
      })
      .expect(HttpStatus.UNAUTHORIZED);

    await request(server)
      .post('/auth/refresh')
      .send({
        channel: 'MOBILE',
        sessionId: sessionBody(changed).sessionId,
        refreshToken: sessionBody(changed).refreshToken,
      })
      .expect(HttpStatus.OK);

    await request(server)
      .post('/auth/logout')
      .set('Authorization', `Bearer ${sessionBody(changed).accessToken}`)
      .expect(HttpStatus.NO_CONTENT);

    await expect(prisma.client.studentDevice.count()).resolves.toBe(0);
  });

  it('executes the real web cookie login, refresh rotation, password change, and logout path', async () => {
    await createUser(webUserId, 'http-web@example.test', PlatformRole.INSTRUCTOR);
    await createCredential(webUserId, 'original web password');

    const login = await request(server)
      .post('/auth/login')
      .set('Origin', trustedOrigin)
      .send({
        email: 'http-web@example.test',
        password: 'original web password',
        channel: 'WEB',
      })
      .expect(HttpStatus.OK);
    const loginBody = responseBody(login);
    const loginCookies = cookiePairs(login);

    expect(loginBody.refreshToken).toBeUndefined();
    expect(loginBody.user).toEqual({ id: webUserId, role: PlatformRole.INSTRUCTOR });
    expect(login.headers['cache-control']).toBe('no-store');
    expect(setCookieHeaders(login).join('\n')).toContain('HttpOnly');
    expect(setCookieHeaders(login).join('\n')).toContain('Path=/auth');
    expect(setCookieHeaders(login).join('\n')).toContain('SameSite=Lax');
    expect(loginCookies).toEqual(
      expect.arrayContaining([
        expect.stringContaining('edvora_refresh='),
        expect.stringContaining('edvora_session='),
      ]),
    );

    await request(server)
      .post('/auth/refresh')
      .set('Cookie', loginCookies)
      .send({ channel: 'WEB' })
      .expect(HttpStatus.FORBIDDEN);

    const refreshed = await request(server)
      .post('/auth/refresh')
      .set('Origin', trustedOrigin)
      .set('Cookie', loginCookies)
      .send({ channel: 'WEB' })
      .expect(HttpStatus.OK);
    const refreshedBody = responseBody(refreshed);
    const refreshedCookies = cookiePairs(refreshed);

    expect(refreshedBody.refreshToken).toBeUndefined();
    expect(refreshedBody.sessionId).toBe(loginBody.sessionId);

    await request(server)
      .post('/auth/refresh')
      .set('Origin', trustedOrigin)
      .set('Cookie', loginCookies)
      .send({ channel: 'WEB' })
      .expect(HttpStatus.UNAUTHORIZED);

    const changed = await request(server)
      .post('/auth/password/change')
      .set('Origin', trustedOrigin)
      .set('Cookie', refreshedCookies)
      .set('Authorization', `Bearer ${String(refreshedBody.accessToken)}`)
      .send({
        currentPassword: 'original web password',
        newPassword: 'changed web password',
      })
      .expect(HttpStatus.OK);
    const changedBody = responseBody(changed);
    const changedCookies = cookiePairs(changed);

    expect(changedBody.refreshToken).toBeUndefined();
    await request(server)
      .post('/auth/refresh')
      .set('Origin', trustedOrigin)
      .set('Cookie', refreshedCookies)
      .send({ channel: 'WEB' })
      .expect(HttpStatus.UNAUTHORIZED);

    await request(server)
      .post('/auth/refresh')
      .set('Origin', trustedOrigin)
      .set('Cookie', changedCookies)
      .send({ channel: 'WEB' })
      .expect(HttpStatus.OK);

    const logout = await request(server)
      .post('/auth/logout')
      .set('Origin', trustedOrigin)
      .set('Cookie', changedCookies)
      .set('Authorization', `Bearer ${String(changedBody.accessToken)}`)
      .expect(HttpStatus.NO_CONTENT);

    expect(setCookieHeaders(logout).join('\n')).toContain('edvora_refresh=;');
    expect(setCookieHeaders(logout).join('\n')).toContain('edvora_session=;');
    await expect(prisma.client.studentDevice.count()).resolves.toBe(0);
  });

  it('completes password reset without auto-login and revokes existing sessions', async () => {
    await createUser(resetUserId, 'http-reset@example.test', PlatformRole.STUDENT);
    await createCredential(resetUserId, 'original reset password');
    const login = await request(server)
      .post('/auth/login')
      .send({
        email: 'http-reset@example.test',
        password: 'original reset password',
        channel: 'MOBILE',
      })
      .expect(HttpStatus.OK);
    const reset = await resetTokens.issue({ userId: resetUserId });

    await request(server)
      .post('/auth/password/reset/complete')
      .send({
        resetToken: reset.rawToken,
        newPassword: 'completed reset password',
      })
      .expect(HttpStatus.NO_CONTENT);

    await request(server)
      .post('/auth/refresh')
      .send({
        channel: 'MOBILE',
        sessionId: sessionBody(login).sessionId,
        refreshToken: sessionBody(login).refreshToken,
      })
      .expect(HttpStatus.UNAUTHORIZED);

    await request(server)
      .post('/auth/login')
      .send({
        email: 'http-reset@example.test',
        password: 'completed reset password',
        channel: 'MOBILE',
      })
      .expect(HttpStatus.OK);

    await expect(
      prisma.client.refreshSession.count({
        where: {
          userId: resetUserId,
          status: RefreshSessionStatus.ACTIVE,
        },
      }),
    ).resolves.toBe(1);
  });

  it('GET /auth/me returns fresh DB-resolved identity for STUDENT, INSTRUCTOR, and PLATFORM_ADMIN, with no sensitive fields and no device requirement', async () => {
    const studentId = '20000000-0000-7000-8000-000000000010';
    const instructorId = '20000000-0000-7000-8000-000000000011';
    const adminId = '20000000-0000-7000-8000-000000000012';

    await createUser(studentId, 'me-student@example.test', PlatformRole.STUDENT, {
      displayName: 'Me Student',
      preferredLanguage: LanguagePreference.AR,
    });
    await createCredential(studentId, 'me student password');
    await createUser(instructorId, 'me-instructor@example.test', PlatformRole.INSTRUCTOR, {
      displayName: 'Me Instructor',
    });
    await createCredential(instructorId, 'me instructor password');
    await createUser(adminId, 'me-admin@example.test', PlatformRole.PLATFORM_ADMIN);
    await createCredential(adminId, 'me admin password');

    const studentLogin = await request(server)
      .post('/auth/login')
      .send({ email: 'me-student@example.test', password: 'me student password', channel: 'MOBILE' })
      .expect(HttpStatus.OK);

    // No StudentDeviceGuard, no installation header sent at all — the account/session identity
    // read must never require an approved device.
    const studentMe = await request(server)
      .get('/auth/me')
      .set('Authorization', `Bearer ${sessionBody(studentLogin).accessToken}`)
      .expect(HttpStatus.OK);
    expect(studentMe.body).toEqual({
      userId: studentId,
      role: PlatformRole.STUDENT,
      email: 'me-student@example.test',
      displayName: 'Me Student',
      preferredLanguage: LanguagePreference.AR,
    });
    await expect(prisma.client.studentDevice.count()).resolves.toBe(0);

    const instructorLogin = await request(server)
      .post('/auth/login')
      .send({ email: 'me-instructor@example.test', password: 'me instructor password', channel: 'MOBILE' })
      .expect(HttpStatus.OK);
    const instructorMe = await request(server)
      .get('/auth/me')
      .set('Authorization', `Bearer ${sessionBody(instructorLogin).accessToken}`)
      .expect(HttpStatus.OK);
    expect(instructorMe.body).toEqual({
      userId: instructorId,
      role: PlatformRole.INSTRUCTOR,
      email: 'me-instructor@example.test',
      displayName: 'Me Instructor',
      preferredLanguage: LanguagePreference.EN,
    });

    const adminLogin = await request(server)
      .post('/auth/login')
      .send({ email: 'me-admin@example.test', password: 'me admin password', channel: 'MOBILE' })
      .expect(HttpStatus.OK);
    const adminMe = await request(server)
      .get('/auth/me')
      .set('Authorization', `Bearer ${sessionBody(adminLogin).accessToken}`)
      .expect(HttpStatus.OK);
    expect(adminMe.body).toEqual({
      userId: adminId,
      role: PlatformRole.PLATFORM_ADMIN,
      email: 'me-admin@example.test',
      displayName: null,
      preferredLanguage: LanguagePreference.EN,
    });

    // No auth/session/device/security-event internals in the raw response, for any role.
    const raw = JSON.stringify([studentMe.body, instructorMe.body, adminMe.body]);
    for (const forbidden of [
      'passwordHash',
      'accessToken',
      'refreshToken',
      'sessionId',
      'tokenHash',
      'clientDeviceIdHash',
      'accountStatus',
      'tenantId',
      'membership',
    ]) {
      expect(raw).not.toContain(forbidden);
    }
  });

  it('GET /auth/me rejects a missing token, a malformed token, and an account that has since become inactive', async () => {
    await request(server).get('/auth/me').expect(HttpStatus.UNAUTHORIZED);
    await request(server).get('/auth/me').set('Authorization', 'Bearer not-a-real-token').expect(HttpStatus.UNAUTHORIZED);

    const userId = '20000000-0000-7000-8000-000000000013';
    await createUser(userId, 'me-inactive@example.test', PlatformRole.STUDENT);
    await createCredential(userId, 'me inactive password');
    const login = await request(server)
      .post('/auth/login')
      .send({ email: 'me-inactive@example.test', password: 'me inactive password', channel: 'MOBILE' })
      .expect(HttpStatus.OK);

    // Still a validly-signed, unexpired access token — the account is deactivated afterward, out
    // of band, the same way an admin action or a deletion request would. `/auth/me` must resolve
    // this fresh from the database, not merely accept a still-valid token.
    await prisma.client.user.update({ where: { id: userId }, data: { accountStatus: AccountStatus.SUSPENDED } });

    const rejected = await request(server)
      .get('/auth/me')
      .set('Authorization', `Bearer ${sessionBody(login).accessToken}`)
      .expect(HttpStatus.FORBIDDEN);
    expect(rejected.body).toMatchObject({ error: { code: 'ACCOUNT_UNAVAILABLE' } });
  });

  async function clearAuthData(): Promise<void> {
    await prisma.client.securityEvent.deleteMany();
    await prisma.client.refreshSession.deleteMany();
    await prisma.client.authCredential.deleteMany();
    await prisma.client.accountActivationToken.deleteMany();
    await prisma.client.passwordResetToken.deleteMany();
    await prisma.client.enrollment.deleteMany();
    await prisma.client.course.deleteMany();
    await prisma.client.tenantStudent.deleteMany();
    await prisma.client.tenantMembership.deleteMany();
    await prisma.client.studentDevice.deleteMany();
    await prisma.client.studentProfile.deleteMany();
    await prisma.client.instructorProfile.deleteMany();
    await prisma.client.tenant.deleteMany();
    await prisma.client.user.deleteMany({
      where: {
        normalizedEmail: {
          endsWith: '@example.test',
        },
      },
    });
  }

  async function createUser(
    id: string,
    email: string,
    platformRole: PlatformRole,
    overrides?: { displayName?: string; preferredLanguage?: LanguagePreference },
  ): Promise<void> {
    await prisma.client.user.create({
      data: {
        id,
        email,
        normalizedEmail: email.toLowerCase(),
        accountStatus: AccountStatus.ACTIVE,
        platformRole,
        displayName: overrides?.displayName ?? null,
        ...(overrides?.preferredLanguage ? { preferredLanguage: overrides.preferredLanguage } : {}),
      },
    });
  }

  async function createCredential(userId: string, password: string): Promise<void> {
    await prisma.client.authCredential.create({
      data: {
        id: uuid.create(),
        userId,
        credentialType: CredentialType.PASSWORD,
        passwordHash: await passwordService.hashPassword(password),
      },
    });
  }
});

type SessionResponseBody = {
  accessToken: string;
  refreshToken: string;
  sessionId: string;
  user: {
    id: string;
    role: PlatformRole;
  };
};

function sessionBody(response: request.Response): SessionResponseBody {
  return response.body as unknown as SessionResponseBody;
}

function responseBody(response: request.Response): Record<string, unknown> {
  return response.body as unknown as Record<string, unknown>;
}

function setCookieHeaders(response: request.Response): string[] {
  const header = response.headers['set-cookie'];

  if (!header) {
    return [];
  }

  return Array.isArray(header) ? header : [header];
}

function cookiePairs(response: request.Response): string[] {
  return setCookieHeaders(response).map((cookie) => cookie.split(';')[0]);
}
