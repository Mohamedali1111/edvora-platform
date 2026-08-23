import {
  AccountActivationPurpose,
  AccountStatus,
  PlatformRole,
  RefreshSessionStatus,
} from '../../../../.generated/prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import type { DatabaseRuntimeConfig } from '../../../infrastructure/database/database.config';
import { testAuthConfig } from '../test-helpers';
import { AccountInactiveError, InvalidRefreshSessionError, RefreshReplayDetectedError } from '../errors/auth.errors';
import { AccountActivationTokenService } from './account-activation-token.service';
import { ClockService } from './clock.service';
import { PasswordResetTokenService } from './password-reset-token.service';
import { RefreshSessionService } from './refresh-session.service';
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

  advance(milliseconds: number): void {
    this.current = new Date(this.current.getTime() + milliseconds);
  }
}

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const maybeDescribe = testDatabaseUrl ? describe : describe.skip;

maybeDescribe('auth primitives PostgreSQL integration', () => {
  let prismaService: PrismaService;
  let clock: MutableClockService;
  let tokenCrypto: TokenCryptoService;
  let refreshSessions: RefreshSessionService;
  let activations: AccountActivationTokenService;
  let resets: PasswordResetTokenService;

  const userId = '00000000-0000-7000-8000-100000000001';
  const suspendedUserId = '00000000-0000-7000-8000-100000000002';
  const actorUserId = '00000000-0000-7000-8000-100000000003';
  const tenantId = '00000000-0000-7000-8000-100000000101';

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
    tokenCrypto = new TokenCryptoService();
    const uuid = new UuidV7Service();

    refreshSessions = new RefreshSessionService(
      prismaService,
      clock,
      tokenCrypto,
      uuid,
      testAuthConfig,
    );
    activations = new AccountActivationTokenService(
      prismaService,
      clock,
      tokenCrypto,
      uuid,
      testAuthConfig,
    );
    resets = new PasswordResetTokenService(prismaService, clock, tokenCrypto, uuid, testAuthConfig);

    await prismaService.client.user.createMany({
      data: [
        {
          id: userId,
          email: 'auth-student@example.test',
          normalizedEmail: 'auth-student@example.test',
          platformRole: PlatformRole.STUDENT,
          accountStatus: AccountStatus.ACTIVE,
          updatedAt: clock.now(),
        },
        {
          id: suspendedUserId,
          email: 'auth-suspended@example.test',
          normalizedEmail: 'auth-suspended@example.test',
          platformRole: PlatformRole.STUDENT,
          accountStatus: AccountStatus.ACTIVE,
          updatedAt: clock.now(),
        },
        {
          id: actorUserId,
          email: 'auth-admin@example.test',
          normalizedEmail: 'auth-admin@example.test',
          platformRole: PlatformRole.PLATFORM_ADMIN,
          accountStatus: AccountStatus.ACTIVE,
          updatedAt: clock.now(),
        },
      ],
      skipDuplicates: true,
    });

    await prismaService.client.tenant.create({
      data: {
        id: tenantId,
        name: 'Auth Test Tenant',
        slug: 'auth-test-tenant',
        updatedAt: clock.now(),
      },
    });
  });

  afterAll(async () => {
    await prismaService.onModuleDestroy();
  });

  beforeEach(() => {
    clock.set(new Date('2026-08-23T12:00:00.000Z'));
  });

  it('rotates refresh sessions once and handles replay/concurrency safely', async () => {
    const issued = await refreshSessions.createSession({ userId, channel: 'MOBILE' });

    const stored = await prismaService.client.refreshSession.findUniqueOrThrow({
      where: { id: issued.sessionId },
    });
    expect(stored.refreshTokenHash).toBe(issued.refreshTokenHash);
    expect(stored.refreshTokenHash).not.toBe(issued.refreshToken);

    const [first, second] = await Promise.allSettled([
      refreshSessions.rotateSession({
        sessionId: issued.sessionId,
        refreshToken: issued.refreshToken,
      }),
      refreshSessions.rotateSession({
        sessionId: issued.sessionId,
        refreshToken: issued.refreshToken,
      }),
    ]);

    const fulfilled = [first, second].filter(
      (result): result is PromiseFulfilledResult<Awaited<ReturnType<RefreshSessionService['rotateSession']>>> =>
        result.status === 'fulfilled',
    );
    const rejected = [first, second].filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toBeInstanceOf(InvalidRefreshSessionError);

    const successorRotation = await refreshSessions.rotateSession({
      sessionId: issued.sessionId,
      refreshToken: fulfilled[0].value.refreshToken,
    });
    expect(successorRotation.refreshToken).not.toBe(fulfilled[0].value.refreshToken);

    await expect(
      refreshSessions.rotateSession({
        sessionId: issued.sessionId,
        refreshToken: issued.refreshToken,
      }),
    ).rejects.toBeInstanceOf(InvalidRefreshSessionError);

    clock.advance(6_000);
    await expect(
      refreshSessions.rotateSession({
        sessionId: issued.sessionId,
        refreshToken: issued.refreshToken,
      }),
    ).rejects.toBeInstanceOf(RefreshReplayDetectedError);

    await expect(
      refreshSessions.rotateSession({
        sessionId: issued.sessionId,
        refreshToken: successorRotation.refreshToken,
      }),
    ).rejects.toBeInstanceOf(InvalidRefreshSessionError);
  });

  it('rejects expired, revoked, and inactive-account refresh sessions', async () => {
    const expired = await refreshSessions.createSession({ userId, channel: 'WEB' });
    await prismaService.client.refreshSession.update({
      where: { id: expired.sessionId },
      data: { expiresAt: new Date('2026-08-23T11:00:00.000Z') },
    });
    await expect(
      refreshSessions.rotateSession({
        sessionId: expired.sessionId,
        refreshToken: expired.refreshToken,
      }),
    ).rejects.toBeInstanceOf(InvalidRefreshSessionError);

    const revoked = await refreshSessions.createSession({ userId, channel: 'WEB' });
    await refreshSessions.revokeSession(revoked.sessionId);
    await expect(
      refreshSessions.rotateSession({
        sessionId: revoked.sessionId,
        refreshToken: revoked.refreshToken,
      }),
    ).rejects.toBeInstanceOf(InvalidRefreshSessionError);

    const suspended = await refreshSessions.createSession({ userId: suspendedUserId, channel: 'WEB' });
    await prismaService.client.user.update({
      where: { id: suspendedUserId },
      data: { accountStatus: AccountStatus.SUSPENDED },
    });
    await expect(
      refreshSessions.rotateSession({
        sessionId: suspended.sessionId,
        refreshToken: suspended.refreshToken,
      }),
    ).rejects.toBeInstanceOf(AccountInactiveError);
  });

  it('revokes current and all refresh sessions', async () => {
    const first = await refreshSessions.createSession({ userId, channel: 'WEB' });
    const second = await refreshSessions.createSession({ userId, channel: 'WEB' });

    await refreshSessions.revokeSession(first.sessionId);
    const firstStored = await prismaService.client.refreshSession.findUniqueOrThrow({
      where: { id: first.sessionId },
    });
    expect(firstStored.status).toBe(RefreshSessionStatus.REVOKED);

    const revokedCount = await refreshSessions.revokeAllUserSessions(userId);
    expect(revokedCount).toBeGreaterThanOrEqual(1);
    const secondStored = await prismaService.client.refreshSession.findUniqueOrThrow({
      where: { id: second.sessionId },
    });
    expect(secondStored.status).toBe(RefreshSessionStatus.REVOKED);
  });

  it('issues and consumes activation tokens atomically', async () => {
    const first = await activations.issue({
      userId,
      purpose: AccountActivationPurpose.STUDENT_ACTIVATION,
      tenantId,
      initiatedByUserId: actorUserId,
    });
    const second = await activations.issue({
      userId,
      purpose: AccountActivationPurpose.STUDENT_ACTIVATION,
      tenantId,
      initiatedByUserId: actorUserId,
    });

    const firstStored = await prismaService.client.accountActivationToken.findUniqueOrThrow({
      where: { id: first.id },
    });
    const secondStored = await prismaService.client.accountActivationToken.findUniqueOrThrow({
      where: { id: second.id },
    });

    expect(firstStored.revokedAt).toBeInstanceOf(Date);
    expect(secondStored.tokenHash).toBe(second.tokenHash);
    expect(secondStored.tokenHash).not.toBe(second.rawToken);

    const [firstConsume, secondConsume] = await Promise.allSettled([
      activations.consume(second.rawToken),
      activations.consume(second.rawToken),
    ]);
    expect([firstConsume, secondConsume].filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect([firstConsume, secondConsume].filter((result) => result.status === 'rejected')).toHaveLength(1);

    const historicalCount = await prismaService.client.accountActivationToken.count({
      where: { userId },
    });
    expect(historicalCount).toBeGreaterThanOrEqual(2);
  });

  it('rejects expired and revoked activation tokens', async () => {
    const expired = await activations.issue({
      userId,
      purpose: AccountActivationPurpose.INSTRUCTOR_ACTIVATION,
      expiresInSeconds: 60,
    });
    clock.advance(61_000);
    await expect(activations.consume(expired.rawToken)).rejects.toThrow();
    clock.set(new Date('2026-08-23T12:00:00.000Z'));

    const revoked = await activations.issue({
      userId,
      purpose: AccountActivationPurpose.INSTRUCTOR_ACTIVATION,
      expiresInSeconds: 60,
    });
    await prismaService.client.accountActivationToken.update({
      where: { id: revoked.id },
      data: { revokedAt: clock.now() },
    });
    await expect(activations.consume(revoked.rawToken)).rejects.toThrow();
  });

  it('issues and consumes password reset tokens atomically', async () => {
    const first = await resets.issue({ userId, initiatedByUserId: actorUserId });
    const second = await resets.issue({ userId, initiatedByUserId: actorUserId });

    const firstStored = await prismaService.client.passwordResetToken.findUniqueOrThrow({
      where: { id: first.id },
    });
    const secondStored = await prismaService.client.passwordResetToken.findUniqueOrThrow({
      where: { id: second.id },
    });

    expect(firstStored.revokedAt).toBeInstanceOf(Date);
    expect(secondStored.tokenHash).toBe(second.tokenHash);
    expect(secondStored.tokenHash).not.toBe(second.rawToken);

    const [firstConsume, secondConsume] = await Promise.allSettled([
      resets.consume(second.rawToken),
      resets.consume(second.rawToken),
    ]);
    expect([firstConsume, secondConsume].filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect([firstConsume, secondConsume].filter((result) => result.status === 'rejected')).toHaveLength(1);
  });

  it('rejects expired and revoked password reset tokens', async () => {
    const expired = await resets.issue({ userId, expiresInSeconds: 60 });
    clock.advance(61_000);
    await expect(resets.consume(expired.rawToken)).rejects.toThrow();
    clock.set(new Date('2026-08-23T12:00:00.000Z'));

    const revoked = await resets.issue({ userId, expiresInSeconds: 60 });
    await prismaService.client.passwordResetToken.update({
      where: { id: revoked.id },
      data: { revokedAt: clock.now() },
    });
    await expect(resets.consume(revoked.rawToken)).rejects.toThrow();
  });
});
