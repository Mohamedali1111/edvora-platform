import { JwtService } from '@nestjs/jwt';
import {
  AccountActivationPurpose,
  AccountStatus,
  CredentialType,
  DevicePlatform,
  PlatformRole,
  RefreshSessionStatus,
  StudentDeviceStatus,
} from '../../../../.generated/prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import type { DatabaseRuntimeConfig } from '../../../infrastructure/database/database.config';
import { testAuthConfig } from '../test-helpers';
import {
  AccountInactiveError,
  ActivationTokenInvalidError,
  CurrentPasswordIncorrectError,
  InvalidCredentialsError,
  InvalidRefreshSessionError,
  NewPasswordSameAsCurrentError,
  PasswordPolicyError,
  ResetTokenConsumedError,
} from '../errors/auth.errors';
import { AccountActivationTokenService } from './account-activation-token.service';
import { AccessTokenService } from './access-token.service';
import { AuthOrchestrationService } from './auth-orchestration.service';
import { ClockService } from './clock.service';
import { PasswordResetTokenService } from './password-reset-token.service';
import { PasswordService } from './password.service';
import { RefreshSessionService } from './refresh-session.service';
import { SecurityEventService } from './security-event.service';
import { TokenCryptoService } from './token-crypto.service';
import { UuidV7Service } from './uuid-v7.service';

class MutableClockService extends ClockService {
  private current = new Date('2026-08-23T12:00:00.000Z');

  override now(): Date {
    return new Date(this.current);
  }

  set(date: Date): void {
    this.current = new Date(date);
  }
}

class FailingAccessTokenService extends AccessTokenService {
  override sign(): Promise<string> {
    return Promise.reject(new Error('Injected access-token signing failure.'));
  }
}

class FailingTransactionalSecurityEventService extends SecurityEventService {
  override recordWithinTransaction(): Promise<void> {
    return Promise.reject(new Error('Injected transactional security-event failure.'));
  }
}

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const maybeDescribe = testDatabaseUrl ? describe : describe.skip;

maybeDescribe('auth orchestration PostgreSQL integration', () => {
  let prismaService: PrismaService;
  let clock: MutableClockService;
  let passwordService: PasswordService;
  let accessTokens: AccessTokenService;
  let refreshSessions: RefreshSessionService;
  let activationTokens: AccountActivationTokenService;
  let resetTokens: PasswordResetTokenService;
  let auth: AuthOrchestrationService;
  let uuid: UuidV7Service;

  const userId = '10000000-0000-7000-8000-000000000001';
  const otherUserId = '10000000-0000-7000-8000-000000000002';
  const suspendedUserId = '10000000-0000-7000-8000-000000000003';
  const deletingUserId = '10000000-0000-7000-8000-000000000004';
  const deletedUserId = '10000000-0000-7000-8000-000000000005';
  const noCredentialUserId = '10000000-0000-7000-8000-000000000006';
  const activationUserId = '10000000-0000-7000-8000-000000000007';
  const activationPurposeUserId = '10000000-0000-7000-8000-000000000008';
  const resetUserId = '10000000-0000-7000-8000-000000000009';
  const weakRehashUserId = '10000000-0000-7000-8000-000000000010';
  const tenantId = '10000000-0000-7000-8000-000000000101';

  beforeAll(async () => {
    const databaseConfig: DatabaseRuntimeConfig = {
      databaseUrl: testDatabaseUrl as string,
      pool: {
        maxConnections: 4,
        connectionTimeoutMillis: 5_000,
        idleTimeoutMillis: 10_000,
      },
    };
    prismaService = new PrismaService(databaseConfig);
    await prismaService.onModuleInit();

    clock = new MutableClockService();
    uuid = new UuidV7Service();
    const tokenCrypto = new TokenCryptoService();
    passwordService = new PasswordService(testAuthConfig);
    accessTokens = new AccessTokenService(new JwtService(), testAuthConfig);
    refreshSessions = new RefreshSessionService(
      prismaService,
      clock,
      tokenCrypto,
      uuid,
      testAuthConfig,
    );
    activationTokens = new AccountActivationTokenService(
      prismaService,
      clock,
      tokenCrypto,
      uuid,
      testAuthConfig,
    );
    resetTokens = new PasswordResetTokenService(prismaService, clock, tokenCrypto, uuid, testAuthConfig);
    const securityEvents = new SecurityEventService(prismaService, clock, uuid);
    auth = new AuthOrchestrationService(
      prismaService,
      passwordService,
      accessTokens,
      refreshSessions,
      activationTokens,
      resetTokens,
      tokenCrypto,
      securityEvents,
      clock,
      uuid,
      testAuthConfig,
    );

    await prismaService.client.tenant.create({
      data: {
        id: tenantId,
        name: 'Auth Orchestration Tenant',
        slug: 'auth-orchestration-tenant',
        updatedAt: clock.now(),
      },
    });
  });

  afterAll(async () => {
    await prismaService.onModuleDestroy();
  });

  beforeEach(async () => {
    clock.set(new Date('2026-08-23T12:00:00.000Z'));
    await clearAuthTables();
    await seedUsers();
  });

  it('logs in with normalized email, authoritative role, session lifetime, and minimal JWT claims', async () => {
    const result = await auth.login({
      email: '  ACTIVE@Example.TEST ',
      password: 'correct horse battery staple',
      channel: 'MOBILE',
    });

    expect(result.user).toEqual({ userId, platformRole: PlatformRole.STUDENT });
    expect(result.accessTokenTtlSeconds).toBe(600);
    expect(result.refreshTokenExpiresAt.toISOString()).toBe('2026-09-22T12:00:00.000Z');

    const payload = await accessTokens.verify(result.accessToken);
    expect(payload).toMatchObject({
      sub: userId,
      sid: result.sessionId,
      role: PlatformRole.STUDENT,
    });
    expect(Object.keys(payload).sort()).toEqual(['aud', 'exp', 'iat', 'iss', 'role', 'sid', 'sub']);

    const session = await prismaService.client.refreshSession.findUniqueOrThrow({
      where: { id: result.sessionId },
    });
    expect(session.userId).toBe(userId);
    expect(session.status).toBe(RefreshSessionStatus.ACTIVE);
  });

  it('rolls back login session creation if access-token signing fails', async () => {
    const failingAuth = createAuthWithOverrides({
      accessTokenService: new FailingAccessTokenService(new JwtService(), testAuthConfig),
    });

    await expect(
      failingAuth.login({
        email: 'active@example.test',
        password: 'correct horse battery staple',
        channel: 'WEB',
      }),
    ).rejects.toThrow('Injected access-token signing failure.');

    await expect(
      prismaService.client.refreshSession.findFirst({ where: { userId } }),
    ).resolves.toBeNull();
  });

  it('uses generic invalid credentials for wrong password, unknown email, and missing credential', async () => {
    await expect(
      auth.login({ email: 'active@example.test', password: 'wrong password value', channel: 'WEB' }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
    await expect(
      auth.login({ email: 'missing@example.test', password: 'wrong password value', channel: 'WEB' }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
    await expect(
      auth.login({ email: 'no-credential@example.test', password: 'wrong password value', channel: 'WEB' }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);

    const failedEvents = await prismaService.client.securityEvent.findMany({
      where: { eventType: 'LOGIN_FAILED' },
    });
    expect(failedEvents).toHaveLength(3);
    expect(JSON.stringify(failedEvents)).not.toContain('missing@example.test');
  });

  it('rejects inactive accounts after valid credentials and rehashes weaker stored password hashes', async () => {
    await expect(
      auth.login({
        email: 'suspended@example.test',
        password: 'correct horse battery staple',
        channel: 'WEB',
      }),
    ).rejects.toBeInstanceOf(AccountInactiveError);
    await expect(
      auth.login({
        email: 'deleting@example.test',
        password: 'correct horse battery staple',
        channel: 'WEB',
      }),
    ).rejects.toBeInstanceOf(AccountInactiveError);
    await expect(
      auth.login({
        email: 'deleted@example.test',
        password: 'correct horse battery staple',
        channel: 'WEB',
      }),
    ).rejects.toBeInstanceOf(AccountInactiveError);

    const before = await prismaService.client.authCredential.findFirstOrThrow({
      where: { userId: weakRehashUserId },
    });
    expect(passwordService.needsRehash(before.passwordHash)).toBe(true);

    await auth.login({
      email: 'weak-rehash@example.test',
      password: 'correct horse battery staple',
      channel: 'WEB',
    });

    const after = await prismaService.client.authCredential.findFirstOrThrow({
      where: { userId: weakRehashUserId },
    });
    expect(after.passwordHash).not.toBe(before.passwordHash);
    expect(passwordService.needsRehash(after.passwordHash)).toBe(false);
  });

  it('activates an account by setting the initial password without email verification or session creation', async () => {
    const issued = await activationTokens.issue({
      userId: activationUserId,
      purpose: AccountActivationPurpose.STUDENT_ACTIVATION,
      tenantId,
      initiatedByUserId: userId,
    });

    const result = await auth.activateAccount({
      activationToken: issued.rawToken,
      expectedPurpose: AccountActivationPurpose.STUDENT_ACTIVATION,
      newPassword: 'new activation password',
    });

    expect(result).toEqual({ userId: activationUserId, platformRole: PlatformRole.STUDENT });
    const credential = await prismaService.client.authCredential.findFirstOrThrow({
      where: { userId: activationUserId },
    });
    expect(credential.passwordHash).not.toBe('new activation password');
    await expect(
      passwordService.verifyPassword('new activation password', credential.passwordHash),
    ).resolves.toBe(true);

    const user = await prismaService.client.user.findUniqueOrThrow({
      where: { id: activationUserId },
    });
    expect(user.emailVerifiedAt).toBeNull();
    await expect(
      auth.activateAccount({
        activationToken: issued.rawToken,
        expectedPurpose: AccountActivationPurpose.STUDENT_ACTIVATION,
        newPassword: 'another activation password',
      }),
    ).rejects.toThrow();
    await expect(
      auth.login({
        email: 'activation@example.test',
        password: 'new activation password',
        channel: 'WEB',
      }),
    ).resolves.toMatchObject({ user: { userId: activationUserId } });
  });

  it('allows at most one concurrent activation and keeps existing credentials intact', async () => {
    const issued = await activationTokens.issue({
      userId: activationUserId,
      purpose: AccountActivationPurpose.STUDENT_ACTIVATION,
    });

    const results = await Promise.allSettled([
      auth.activateAccount({
        activationToken: issued.rawToken,
        expectedPurpose: AccountActivationPurpose.STUDENT_ACTIVATION,
        newPassword: 'new activation password',
      }),
      auth.activateAccount({
        activationToken: issued.rawToken,
        expectedPurpose: AccountActivationPurpose.STUDENT_ACTIVATION,
        newPassword: 'new activation password',
      }),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    await expect(
      prismaService.client.authCredential.count({ where: { userId: activationUserId } }),
    ).resolves.toBe(1);

    const existing = await activationTokens.issue({
      userId,
      purpose: AccountActivationPurpose.STUDENT_ACTIVATION,
    });
    const before = await prismaService.client.authCredential.findFirstOrThrow({ where: { userId } });

    await expect(
      auth.activateAccount({
        activationToken: existing.rawToken,
        expectedPurpose: AccountActivationPurpose.STUDENT_ACTIVATION,
        newPassword: 'should not overwrite password',
      }),
    ).rejects.toBeInstanceOf(ActivationTokenInvalidError);

    const after = await prismaService.client.authCredential.findFirstOrThrow({ where: { userId } });
    expect(after.passwordHash).toBe(before.passwordHash);
  });

  it('rolls back activation token consumption and credential creation on transactional failure', async () => {
    const failingAuth = createAuthWithOverrides({
      securityEventService: new FailingTransactionalSecurityEventService(prismaService, clock, uuid),
    });
    const issued = await activationTokens.issue({
      userId: activationUserId,
      purpose: AccountActivationPurpose.STUDENT_ACTIVATION,
    });

    await expect(
      failingAuth.activateAccount({
        activationToken: issued.rawToken,
        expectedPurpose: AccountActivationPurpose.STUDENT_ACTIVATION,
        newPassword: 'new activation password',
      }),
    ).rejects.toThrow('Injected transactional security-event failure.');

    const storedToken = await prismaService.client.accountActivationToken.findUniqueOrThrow({
      where: { id: issued.id },
    });
    expect(storedToken.consumedAt).toBeNull();
    await expect(
      prismaService.client.authCredential.findFirst({ where: { userId: activationUserId } }),
    ).resolves.toBeNull();
    await expect(
      prismaService.client.securityEvent.findFirst({ where: { eventType: 'ACCOUNT_ACTIVATED' } }),
    ).resolves.toBeNull();
  });

  it('does not consume an activation token for weak password or wrong purpose', async () => {
    const weak = await activationTokens.issue({
      userId: activationUserId,
      purpose: AccountActivationPurpose.STUDENT_ACTIVATION,
    });
    await expect(
      auth.activateAccount({
        activationToken: weak.rawToken,
        expectedPurpose: AccountActivationPurpose.STUDENT_ACTIVATION,
        newPassword: 'short',
      }),
    ).rejects.toBeInstanceOf(PasswordPolicyError);
    const weakStored = await prismaService.client.accountActivationToken.findUniqueOrThrow({
      where: { id: weak.id },
    });
    expect(weakStored.consumedAt).toBeNull();

    const wrongPurpose = await activationTokens.issue({
      userId: activationPurposeUserId,
      purpose: AccountActivationPurpose.INSTRUCTOR_ACTIVATION,
    });
    await expect(
      auth.activateAccount({
        activationToken: wrongPurpose.rawToken,
        expectedPurpose: AccountActivationPurpose.STUDENT_ACTIVATION,
        newPassword: 'new activation password',
      }),
    ).rejects.toBeInstanceOf(ActivationTokenInvalidError);
    const wrongPurposeStored = await prismaService.client.accountActivationToken.findUniqueOrThrow({
      where: { id: wrongPurpose.id },
    });
    expect(wrongPurposeStored.consumedAt).toBeNull();
  });

  it('refreshes an authenticated session and issues a new access token bound to the same session', async () => {
    const login = await auth.login({
      email: 'active@example.test',
      password: 'correct horse battery staple',
      channel: 'WEB',
    });
    const refreshed = await auth.refreshAuthenticatedSession({
      sessionId: login.sessionId,
      refreshToken: login.refreshToken,
    });

    expect(refreshed.sessionId).toBe(login.sessionId);
    expect(refreshed.refreshToken).not.toBe(login.refreshToken);
    const payload = await accessTokens.verify(refreshed.accessToken);
    expect(payload.sub).toBe(userId);
    expect(payload.sid).toBe(login.sessionId);
    expect(payload.role).toBe(PlatformRole.STUDENT);
  });

  it('logs out current session idempotently and logout-all affects only that user', async () => {
    const deviceId = uuid.create();
    await prismaService.client.studentDevice.create({
      data: {
        id: deviceId,
        studentUserId: userId,
        clientDeviceIdHash: 'logout-device-hash',
        platform: DevicePlatform.IOS,
        status: StudentDeviceStatus.ACTIVE,
      },
    });

    const first = await auth.login({
      email: 'active@example.test',
      password: 'correct horse battery staple',
      channel: 'WEB',
    });
    const second = await auth.login({
      email: 'active@example.test',
      password: 'correct horse battery staple',
      channel: 'WEB',
    });
    const other = await auth.login({
      email: 'other@example.test',
      password: 'correct horse battery staple',
      channel: 'WEB',
    });

    await auth.logout({ userId: otherUserId, sessionId: first.sessionId });
    const firstAfterWrongUserLogout = await prismaService.client.refreshSession.findUniqueOrThrow({
      where: { id: first.sessionId },
    });
    expect(firstAfterWrongUserLogout.status).toBe(RefreshSessionStatus.ACTIVE);

    await auth.logout({ userId, sessionId: first.sessionId });
    await auth.logout({ userId, sessionId: first.sessionId });
    await expect(
      auth.refreshAuthenticatedSession({ sessionId: first.sessionId, refreshToken: first.refreshToken }),
    ).rejects.toBeInstanceOf(InvalidRefreshSessionError);

    await auth.logoutAll({ userId });
    const secondSession = await prismaService.client.refreshSession.findUniqueOrThrow({
      where: { id: second.sessionId },
    });
    const otherSession = await prismaService.client.refreshSession.findUniqueOrThrow({
      where: { id: other.sessionId },
    });
    const device = await prismaService.client.studentDevice.findUniqueOrThrow({ where: { id: deviceId } });
    expect(secondSession.status).toBe(RefreshSessionStatus.REVOKED);
    expect(otherSession.status).toBe(RefreshSessionStatus.ACTIVE);
    expect(device.status).toBe(StudentDeviceStatus.ACTIVE);
  });

  it('changes password, revokes other sessions, and rotates the surviving current session', async () => {
    const current = await auth.login({
      email: 'active@example.test',
      password: 'correct horse battery staple',
      channel: 'WEB',
    });
    const other = await auth.login({
      email: 'active@example.test',
      password: 'correct horse battery staple',
      channel: 'WEB',
    });

    await expect(
      auth.changePassword({
        userId,
        currentSessionId: current.sessionId,
        currentPassword: 'wrong current password',
        newPassword: 'brand new password value',
      }),
    ).rejects.toBeInstanceOf(CurrentPasswordIncorrectError);
    await expect(
      auth.changePassword({
        userId,
        currentSessionId: current.sessionId,
        currentPassword: 'correct horse battery staple',
        newPassword: 'correct horse battery staple',
      }),
    ).rejects.toBeInstanceOf(NewPasswordSameAsCurrentError);

    const changed = await auth.changePassword({
      userId,
      currentSessionId: current.sessionId,
      currentPassword: 'correct horse battery staple',
      newPassword: 'brand new password value',
    });
    expect(changed.sessionId).toBe(current.sessionId);
    expect(changed.refreshToken).not.toBe(current.refreshToken);

    const otherSession = await prismaService.client.refreshSession.findUniqueOrThrow({
      where: { id: other.sessionId },
    });
    expect(otherSession.status).toBe(RefreshSessionStatus.REVOKED);
    await expect(
      auth.refreshAuthenticatedSession({
        sessionId: current.sessionId,
        refreshToken: current.refreshToken,
      }),
    ).rejects.toBeInstanceOf(InvalidRefreshSessionError);
    await expect(
      auth.refreshAuthenticatedSession({
        sessionId: changed.sessionId,
        refreshToken: changed.refreshToken,
      }),
    ).resolves.toMatchObject({ user: { userId } });
    await expect(
      auth.login({ email: 'active@example.test', password: 'brand new password value', channel: 'WEB' }),
    ).resolves.toMatchObject({ user: { userId } });
  });

  it('rolls back password change credential and session mutations on transactional failure', async () => {
    const failingAuth = createAuthWithOverrides({
      securityEventService: new FailingTransactionalSecurityEventService(prismaService, clock, uuid),
    });
    const current = await auth.login({
      email: 'active@example.test',
      password: 'correct horse battery staple',
      channel: 'WEB',
    });
    const other = await auth.login({
      email: 'active@example.test',
      password: 'correct horse battery staple',
      channel: 'WEB',
    });
    const beforeCredential = await prismaService.client.authCredential.findFirstOrThrow({
      where: { userId },
    });

    await expect(
      failingAuth.changePassword({
        userId,
        currentSessionId: current.sessionId,
        currentPassword: 'correct horse battery staple',
        newPassword: 'brand new password value',
      }),
    ).rejects.toThrow('Injected transactional security-event failure.');

    const afterCredential = await prismaService.client.authCredential.findFirstOrThrow({ where: { userId } });
    expect(afterCredential.passwordHash).toBe(beforeCredential.passwordHash);
    await expect(
      passwordService.verifyPassword('correct horse battery staple', afterCredential.passwordHash),
    ).resolves.toBe(true);
    const currentSession = await prismaService.client.refreshSession.findUniqueOrThrow({
      where: { id: current.sessionId },
    });
    const otherSession = await prismaService.client.refreshSession.findUniqueOrThrow({
      where: { id: other.sessionId },
    });
    expect(currentSession.status).toBe(RefreshSessionStatus.ACTIVE);
    expect(currentSession.refreshTokenHash).toBe(
      new TokenCryptoService().hashOpaqueToken(current.refreshToken),
    );
    expect(otherSession.status).toBe(RefreshSessionStatus.ACTIVE);
    await expect(
      prismaService.client.securityEvent.findFirst({ where: { eventType: 'PASSWORD_CHANGED' } }),
    ).resolves.toBeNull();
  });

  it('rolls back current-session password change rotation if access-token signing fails', async () => {
    const failingAuth = createAuthWithOverrides({
      accessTokenService: new FailingAccessTokenService(new JwtService(), testAuthConfig),
    });
    const current = await auth.login({
      email: 'active@example.test',
      password: 'correct horse battery staple',
      channel: 'WEB',
    });
    const other = await auth.login({
      email: 'active@example.test',
      password: 'correct horse battery staple',
      channel: 'WEB',
    });

    await expect(
      failingAuth.changePassword({
        userId,
        currentSessionId: current.sessionId,
        currentPassword: 'correct horse battery staple',
        newPassword: 'brand new password value',
      }),
    ).rejects.toThrow('Injected access-token signing failure.');

    const credential = await prismaService.client.authCredential.findFirstOrThrow({ where: { userId } });
    await expect(
      passwordService.verifyPassword('correct horse battery staple', credential.passwordHash),
    ).resolves.toBe(true);
    await expect(
      auth.refreshAuthenticatedSession({
        sessionId: current.sessionId,
        refreshToken: current.refreshToken,
      }),
    ).resolves.toMatchObject({ user: { userId } });
    const otherSession = await prismaService.client.refreshSession.findUniqueOrThrow({
      where: { id: other.sessionId },
    });
    expect(otherSession.status).toBe(RefreshSessionStatus.ACTIVE);
  });

  it('completes password reset atomically, revokes all sessions, and requires normal login afterward', async () => {
    const first = await auth.login({
      email: 'reset@example.test',
      password: 'correct horse battery staple',
      channel: 'WEB',
    });
    const second = await auth.login({
      email: 'reset@example.test',
      password: 'correct horse battery staple',
      channel: 'MOBILE',
    });
    const reset = await resetTokens.issue({ userId: resetUserId });

    await auth.completePasswordReset({
      resetToken: reset.rawToken,
      newPassword: 'reset completed password',
    });

    const storedReset = await prismaService.client.passwordResetToken.findUniqueOrThrow({
      where: { id: reset.id },
    });
    expect(storedReset.consumedAt).toBeInstanceOf(Date);

    for (const sessionId of [first.sessionId, second.sessionId]) {
      const session = await prismaService.client.refreshSession.findUniqueOrThrow({ where: { id: sessionId } });
      expect(session.status).toBe(RefreshSessionStatus.REVOKED);
    }
    await expect(
      auth.refreshAuthenticatedSession({ sessionId: first.sessionId, refreshToken: first.refreshToken }),
    ).rejects.toBeInstanceOf(InvalidRefreshSessionError);
    await expect(
      auth.login({ email: 'reset@example.test', password: 'reset completed password', channel: 'WEB' }),
    ).resolves.toMatchObject({ user: { userId: resetUserId } });
    await expect(
      auth.completePasswordReset({
        resetToken: reset.rawToken,
        newPassword: 'another reset password',
      }),
    ).rejects.toBeInstanceOf(ResetTokenConsumedError);
  });

  it('rolls back password reset token, credential, sessions, and event on transactional failure', async () => {
    const failingAuth = createAuthWithOverrides({
      securityEventService: new FailingTransactionalSecurityEventService(prismaService, clock, uuid),
    });
    const first = await auth.login({
      email: 'reset@example.test',
      password: 'correct horse battery staple',
      channel: 'WEB',
    });
    const reset = await resetTokens.issue({ userId: resetUserId });
    const beforeCredential = await prismaService.client.authCredential.findFirstOrThrow({
      where: { userId: resetUserId },
    });

    await expect(
      failingAuth.completePasswordReset({
        resetToken: reset.rawToken,
        newPassword: 'reset completed password',
      }),
    ).rejects.toThrow('Injected transactional security-event failure.');

    const storedReset = await prismaService.client.passwordResetToken.findUniqueOrThrow({
      where: { id: reset.id },
    });
    const afterCredential = await prismaService.client.authCredential.findFirstOrThrow({
      where: { userId: resetUserId },
    });
    const session = await prismaService.client.refreshSession.findUniqueOrThrow({
      where: { id: first.sessionId },
    });

    expect(storedReset.consumedAt).toBeNull();
    expect(afterCredential.passwordHash).toBe(beforeCredential.passwordHash);
    expect(session.status).toBe(RefreshSessionStatus.ACTIVE);
    await expect(
      prismaService.client.securityEvent.findFirst({ where: { eventType: 'PASSWORD_RESET_COMPLETED' } }),
    ).resolves.toBeNull();
  });

  it('does not consume reset token when new password policy fails', async () => {
    const reset = await resetTokens.issue({ userId: resetUserId });

    await expect(
      auth.completePasswordReset({ resetToken: reset.rawToken, newPassword: 'short' }),
    ).rejects.toBeInstanceOf(PasswordPolicyError);

    const storedReset = await prismaService.client.passwordResetToken.findUniqueOrThrow({
      where: { id: reset.id },
    });
    expect(storedReset.consumedAt).toBeNull();
  });

  async function clearAuthTables(): Promise<void> {
    await prismaService.client.securityEvent.deleteMany();
    await prismaService.client.refreshSession.deleteMany();
    await prismaService.client.studentDevice.deleteMany();
    await prismaService.client.authCredential.deleteMany();
    await prismaService.client.accountActivationToken.deleteMany();
    await prismaService.client.passwordResetToken.deleteMany();
    await prismaService.client.user.deleteMany({
      where: {
        normalizedEmail: {
          endsWith: '@example.test',
        },
      },
    });
  }

  async function seedUsers(): Promise<void> {
    const passwordHash = await passwordService.hashPassword('correct horse battery staple');
    const weakPasswordHash = await new PasswordService({
      ...testAuthConfig,
      argon2id: {
        memoryCostKiB: 8 * 1024,
        timeCost: 2,
        parallelism: 1,
      },
    }).hashPassword('correct horse battery staple');

    const users = [
      userInput(userId, 'active@example.test', PlatformRole.STUDENT, AccountStatus.ACTIVE),
      userInput(otherUserId, 'other@example.test', PlatformRole.INSTRUCTOR, AccountStatus.ACTIVE),
      userInput(suspendedUserId, 'suspended@example.test', PlatformRole.STUDENT, AccountStatus.SUSPENDED),
      userInput(deletingUserId, 'deleting@example.test', PlatformRole.STUDENT, AccountStatus.DELETION_REQUESTED),
      userInput(deletedUserId, 'deleted@example.test', PlatformRole.STUDENT, AccountStatus.DELETED),
      userInput(noCredentialUserId, 'no-credential@example.test', PlatformRole.STUDENT, AccountStatus.ACTIVE),
      userInput(activationUserId, 'activation@example.test', PlatformRole.STUDENT, AccountStatus.ACTIVE),
      userInput(
        activationPurposeUserId,
        'activation-purpose@example.test',
        PlatformRole.INSTRUCTOR,
        AccountStatus.ACTIVE,
      ),
      userInput(resetUserId, 'reset@example.test', PlatformRole.STUDENT, AccountStatus.ACTIVE),
      userInput(weakRehashUserId, 'weak-rehash@example.test', PlatformRole.STUDENT, AccountStatus.ACTIVE),
    ];

    await prismaService.client.user.createMany({ data: users });

    const credentialRows = [
      credentialInput(userId, passwordHash),
      credentialInput(otherUserId, passwordHash),
      credentialInput(suspendedUserId, passwordHash),
      credentialInput(deletingUserId, passwordHash),
      credentialInput(deletedUserId, passwordHash),
      credentialInput(resetUserId, passwordHash),
      credentialInput(weakRehashUserId, weakPasswordHash),
    ];
    await prismaService.client.authCredential.createMany({ data: credentialRows });
  }

  function userInput(
    id: string,
    email: string,
    platformRole: PlatformRole,
    accountStatus: AccountStatus,
  ): {
    id: string;
    email: string;
    normalizedEmail: string;
    platformRole: PlatformRole;
    accountStatus: AccountStatus;
    updatedAt: Date;
  } {
    return {
      id,
      email,
      normalizedEmail: email,
      platformRole,
      accountStatus,
      updatedAt: clock.now(),
    };
  }

  function credentialInput(
    userIdForCredential: string,
    passwordHash: string,
  ): {
    id: string;
    userId: string;
    credentialType: CredentialType;
    passwordHash: string;
    passwordUpdatedAt: Date;
    updatedAt: Date;
  } {
    return {
      id: uuid.create(),
      userId: userIdForCredential,
      credentialType: CredentialType.PASSWORD,
      passwordHash,
      passwordUpdatedAt: clock.now(),
      updatedAt: clock.now(),
    };
  }

  function createAuthWithOverrides(input: {
    accessTokenService?: AccessTokenService;
    securityEventService?: SecurityEventService;
  }): AuthOrchestrationService {
    return new AuthOrchestrationService(
      prismaService,
      passwordService,
      input.accessTokenService ?? accessTokens,
      refreshSessions,
      activationTokens,
      resetTokens,
      new TokenCryptoService(),
      input.securityEventService ?? new SecurityEventService(prismaService, clock, uuid),
      clock,
      uuid,
      testAuthConfig,
    );
  }
});
