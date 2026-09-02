import { JwtService } from '@nestjs/jwt';
import { PlatformRole } from '../../.generated/prisma/client';
import { PrismaService } from '../infrastructure/database/prisma.service';
import type { DatabaseRuntimeConfig } from '../infrastructure/database/database.config';
import { testAuthConfig } from '../modules/auth/test-helpers';
import { AccessTokenService } from '../modules/auth/services/access-token.service';
import { AccountActivationTokenService } from '../modules/auth/services/account-activation-token.service';
import { AuthOrchestrationService } from '../modules/auth/services/auth-orchestration.service';
import { ClockService } from '../modules/auth/services/clock.service';
import { InvalidCredentialsError, PasswordPolicyError } from '../modules/auth/errors/auth.errors';
import { PasswordResetTokenService } from '../modules/auth/services/password-reset-token.service';
import { PasswordService } from '../modules/auth/services/password.service';
import { RefreshSessionService } from '../modules/auth/services/refresh-session.service';
import { SecurityEventService } from '../modules/auth/services/security-event.service';
import { TokenCryptoService } from '../modules/auth/services/token-crypto.service';
import { UuidV7Service } from '../modules/auth/services/uuid-v7.service';
import { bootstrapPlatformAdmin } from './platform-admin-bootstrap';
import { PlatformAdminAlreadyExistsError } from './platform-admin-bootstrap.errors';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const maybeDescribe = testDatabaseUrl ? describe : describe.skip;

maybeDescribe('platform admin bootstrap PostgreSQL integration', () => {
  let prismaService: PrismaService;
  let passwordService: PasswordService;
  let clock: ClockService;
  let uuid: UuidV7Service;
  let auth: AuthOrchestrationService;

  beforeAll(async () => {
    const databaseConfig: DatabaseRuntimeConfig = {
      databaseUrl: testDatabaseUrl as string,
      pool: { maxConnections: 4, connectionTimeoutMillis: 5_000, idleTimeoutMillis: 10_000 },
    };
    prismaService = new PrismaService(databaseConfig);
    await prismaService.onModuleInit();

    passwordService = new PasswordService(testAuthConfig);
    clock = new ClockService();
    uuid = new UuidV7Service();
    const tokenCrypto = new TokenCryptoService();

    // Full real AuthOrchestrationService wiring (mirrors auth-orchestration.postgres-test.ts)
    // so the "created admin can authenticate" assertions below exercise the exact, unmodified
    // production /auth/login code path - not a re-implementation of it.
    auth = new AuthOrchestrationService(
      prismaService,
      passwordService,
      new AccessTokenService(new JwtService(), testAuthConfig),
      new RefreshSessionService(prismaService, clock, tokenCrypto, uuid, testAuthConfig),
      new AccountActivationTokenService(prismaService, clock, tokenCrypto, uuid, testAuthConfig),
      new PasswordResetTokenService(prismaService, clock, tokenCrypto, uuid, testAuthConfig),
      tokenCrypto,
      new SecurityEventService(prismaService, clock, uuid),
      clock,
      uuid,
      testAuthConfig,
    );
  });

  afterAll(async () => {
    await prismaService.onModuleDestroy();
  });

  // This tool's own invariant ("at most one initial PLATFORM_ADMIN") is inherently a
  // whole-table check, so each test needs the table free of PLATFORM_ADMIN rows regardless of
  // what other *.postgres-test.ts fixtures left behind in this shared, disposable database.
  // Safe because `test:auth:postgres` runs with --runInBand: test files never interleave, and
  // every other suite recreates its own PLATFORM_ADMIN fixtures fresh in its own beforeAll, so
  // deleting stale ones here cannot affect a suite that already finished or has not started.
  beforeEach(async () => {
    await prismaService.client.user.deleteMany({ where: { platformRole: PlatformRole.PLATFORM_ADMIN } });
  });

  it('creates the first platform admin, active and able to authenticate through the normal /auth/login path', async () => {
    const result = await bootstrapPlatformAdmin(
      { prismaService, passwordService, clock, uuid },
      { email: 'bootstrap-admin@example.test', password: 'correct horse battery staple' },
    );

    expect(result.outcome).toBe('created');

    const session = await auth.login({
      email: 'bootstrap-admin@example.test',
      password: 'correct horse battery staple',
      channel: 'WEB',
    });

    expect(session.user.userId).toBe(result.userId);
    expect(session.user.platformRole).toBe(PlatformRole.PLATFORM_ADMIN);

    // No permanently minted/bypassed credential: a wrong password on the same real login path
    // still fails normally.
    await expect(
      auth.login({ email: 'bootstrap-admin@example.test', password: 'wrong password entirely', channel: 'WEB' }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it('stores the password hashed with argon2id, never in plaintext', async () => {
    const result = await bootstrapPlatformAdmin(
      { prismaService, passwordService, clock, uuid },
      { email: 'bootstrap-hash@example.test', password: 'correct horse battery staple' },
    );

    const credential = await prismaService.client.authCredential.findFirstOrThrow({
      where: { userId: result.userId },
    });

    expect(credential.passwordHash).toContain('$argon2id$');
    expect(credential.passwordHash).not.toBe('correct horse battery staple');
    expect(credential.passwordHash).not.toContain('correct horse battery staple');
  });

  it('normalizes email and no-ops on a same-admin rerun without mutating the stored password', async () => {
    const first = await bootstrapPlatformAdmin(
      { prismaService, passwordService, clock, uuid },
      { email: 'Bootstrap-Rerun@Example.TEST', password: 'correct horse battery staple' },
    );
    const firstCredential = await prismaService.client.authCredential.findFirstOrThrow({
      where: { userId: first.userId },
    });

    // Same admin (case/whitespace-normalized email), different password on the rerun.
    const second = await bootstrapPlatformAdmin(
      { prismaService, passwordService, clock, uuid },
      { email: '  bootstrap-rerun@example.test  ', password: 'a totally different passphrase' },
    );

    expect(second).toEqual({ outcome: 'noop', userId: first.userId });

    const secondCredential = await prismaService.client.authCredential.findFirstOrThrow({
      where: { userId: first.userId },
    });
    expect(secondCredential.passwordHash).toBe(firstCredential.passwordHash);

    // The original password still works; the rerun's password was never applied.
    const session = await auth.login({
      email: 'bootstrap-rerun@example.test',
      password: 'correct horse battery staple',
      channel: 'WEB',
    });
    expect(session.user.userId).toBe(first.userId);

    await expect(
      auth.login({
        email: 'bootstrap-rerun@example.test',
        password: 'a totally different passphrase',
        channel: 'WEB',
      }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it('refuses to create a second admin with a different email and leaves exactly one admin in place', async () => {
    const first = await bootstrapPlatformAdmin(
      { prismaService, passwordService, clock, uuid },
      { email: 'bootstrap-first@example.test', password: 'correct horse battery staple' },
    );

    await expect(
      bootstrapPlatformAdmin(
        { prismaService, passwordService, clock, uuid },
        { email: 'bootstrap-second@example.test', password: 'another correct passphrase' },
      ),
    ).rejects.toBeInstanceOf(PlatformAdminAlreadyExistsError);

    const admins = await prismaService.client.user.findMany({
      where: { platformRole: PlatformRole.PLATFORM_ADMIN },
    });
    expect(admins).toHaveLength(1);
    expect(admins[0].id).toBe(first.userId);
  });

  it('rejects a password that fails the normal password policy and creates no row', async () => {
    await expect(
      bootstrapPlatformAdmin(
        { prismaService, passwordService, clock, uuid },
        { email: 'bootstrap-weak@example.test', password: 'too-short' },
      ),
    ).rejects.toBeInstanceOf(PasswordPolicyError);

    const admins = await prismaService.client.user.findMany({
      where: { platformRole: PlatformRole.PLATFORM_ADMIN },
    });
    expect(admins).toHaveLength(0);
  });

  it('allows exactly one admin to win a concurrent bootstrap race for different emails', async () => {
    const [first, second] = await Promise.allSettled([
      bootstrapPlatformAdmin(
        { prismaService, passwordService, clock, uuid },
        { email: 'bootstrap-race-a@example.test', password: 'correct horse battery staple' },
      ),
      bootstrapPlatformAdmin(
        { prismaService, passwordService, clock, uuid },
        { email: 'bootstrap-race-b@example.test', password: 'correct horse battery staple' },
      ),
    ]);

    const fulfilled = [first, second].filter(
      (result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof bootstrapPlatformAdmin>>> =>
        result.status === 'fulfilled',
    );
    const rejected = [first, second].filter((result): result is PromiseRejectedResult => result.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(fulfilled[0].value.outcome).toBe('created');
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(PlatformAdminAlreadyExistsError);

    const admins = await prismaService.client.user.findMany({
      where: { platformRole: PlatformRole.PLATFORM_ADMIN },
    });
    expect(admins).toHaveLength(1);
  });
});
