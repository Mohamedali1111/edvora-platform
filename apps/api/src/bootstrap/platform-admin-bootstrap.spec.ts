import { PasswordPolicyError } from '../modules/auth/errors/auth.errors';
import { testAuthConfig } from '../modules/auth/test-helpers';
import { ClockService } from '../modules/auth/services/clock.service';
import { PasswordService } from '../modules/auth/services/password.service';
import { UuidV7Service } from '../modules/auth/services/uuid-v7.service';
import type { PrismaService } from '../infrastructure/database/prisma.service';
import { bootstrapPlatformAdmin, readPlatformAdminBootstrapInput } from './platform-admin-bootstrap';
import {
  BootstrapEmailInvalidError,
  BootstrapEmailRequiredError,
  BootstrapPasswordRequiredError,
  PlatformAdminAlreadyExistsError,
} from './platform-admin-bootstrap.errors';

describe('readPlatformAdminBootstrapInput', () => {
  it('rejects a missing email', () => {
    expect(() =>
      readPlatformAdminBootstrapInput({ PLATFORM_ADMIN_BOOTSTRAP_PASSWORD: 'correct horse battery staple' }),
    ).toThrow(BootstrapEmailRequiredError);
  });

  it('rejects a malformed email', () => {
    expect(() =>
      readPlatformAdminBootstrapInput({
        PLATFORM_ADMIN_BOOTSTRAP_EMAIL: 'not-an-email',
        PLATFORM_ADMIN_BOOTSTRAP_PASSWORD: 'correct horse battery staple',
      }),
    ).toThrow(BootstrapEmailInvalidError);
  });

  it('rejects a missing password', () => {
    expect(() =>
      readPlatformAdminBootstrapInput({ PLATFORM_ADMIN_BOOTSTRAP_EMAIL: 'admin@example.test' }),
    ).toThrow(BootstrapPasswordRequiredError);
  });

  it('returns trimmed, validated input', () => {
    const input = readPlatformAdminBootstrapInput({
      PLATFORM_ADMIN_BOOTSTRAP_EMAIL: '  admin@example.test  ',
      PLATFORM_ADMIN_BOOTSTRAP_PASSWORD: 'correct horse battery staple',
    });

    expect(input).toEqual({ email: 'admin@example.test', password: 'correct horse battery staple' });
  });
});

type UserCreateArgs = {
  data: {
    id: string;
    email: string;
    normalizedEmail: string;
    displayName: string;
    platformRole: string;
    accountStatus: string;
    createdAt: Date;
  };
};

type AuthCredentialCreateArgs = {
  data: {
    id: string;
    userId: string;
    credentialType: string;
    passwordHash: string;
    passwordUpdatedAt: Date;
  };
};

type MockTx = {
  $executeRaw: jest.Mock<Promise<void>, unknown[]>;
  user: {
    findFirst: jest.Mock<Promise<{ id: string; normalizedEmail: string } | null>, unknown[]>;
    create: jest.Mock<Promise<void>, [UserCreateArgs]>;
  };
  authCredential: {
    create: jest.Mock<Promise<void>, [AuthCredentialCreateArgs]>;
  };
};

function createMockTx(existingAdmin: { id: string; normalizedEmail: string } | null): MockTx {
  const executeRaw = jest.fn<Promise<void>, unknown[]>().mockResolvedValue(undefined);
  const findFirst = jest
    .fn<Promise<{ id: string; normalizedEmail: string } | null>, unknown[]>()
    .mockResolvedValue(existingAdmin);
  const userCreate = jest.fn<Promise<void>, [UserCreateArgs]>().mockResolvedValue(undefined);
  const credentialCreate = jest.fn<Promise<void>, [AuthCredentialCreateArgs]>().mockResolvedValue(undefined);

  return {
    $executeRaw: executeRaw,
    user: {
      findFirst,
      create: userCreate,
    },
    authCredential: {
      create: credentialCreate,
    },
  };
}

function createMockPrismaService(tx: MockTx): { prismaService: PrismaService; transaction: jest.Mock } {
  const transaction = jest.fn((callback: (tx: MockTx) => unknown) => callback(tx));
  const prismaService = { client: { $transaction: transaction } } as unknown as PrismaService;

  return { prismaService, transaction };
}

describe('bootstrapPlatformAdmin', () => {
  const passwordService = new PasswordService(testAuthConfig);
  const clock = new ClockService();
  const uuid = new UuidV7Service();

  it('creates the first platform admin when none exists, hashed with the real password service', async () => {
    const tx = createMockTx(null);
    const { prismaService, transaction } = createMockPrismaService(tx);

    const result = await bootstrapPlatformAdmin(
      { prismaService, passwordService, clock, uuid },
      { email: 'admin@example.test', password: 'correct horse battery staple' },
    );

    expect(result.outcome).toBe('created');
    expect(transaction).toHaveBeenCalledTimes(1);
    // The advisory lock must be acquired before the existence check, inside the same
    // transaction, so a concurrent invocation blocks before it can observe a stale "no admin"
    // read.
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.user.findFirst).toHaveBeenCalledTimes(1);
    const lockOrder = tx.$executeRaw.mock.invocationCallOrder[0];
    const findFirstOrder = tx.user.findFirst.mock.invocationCallOrder[0];
    expect(lockOrder).toBeLessThan(findFirstOrder);

    expect(tx.user.create).toHaveBeenCalledTimes(1);
    const userCreateData = tx.user.create.mock.calls[0][0].data;
    expect(userCreateData).toMatchObject({
      email: 'admin@example.test',
      normalizedEmail: 'admin@example.test',
      platformRole: 'PLATFORM_ADMIN',
      accountStatus: 'ACTIVE',
    });

    expect(tx.authCredential.create).toHaveBeenCalledTimes(1);
    const credentialData = tx.authCredential.create.mock.calls[0][0].data;
    expect(credentialData.credentialType).toBe('PASSWORD');
    // Stored value must be an argon2id hash, never the plaintext password.
    expect(credentialData.passwordHash).toContain('$argon2id$');
    expect(credentialData.passwordHash).not.toBe('correct horse battery staple');
    await expect(
      passwordService.verifyPassword('correct horse battery staple', credentialData.passwordHash),
    ).resolves.toBe(true);
  });

  it('no-ops without touching credentials when an admin with the same normalized email already exists', async () => {
    const tx = createMockTx({ id: 'existing-admin-id', normalizedEmail: 'admin@example.test' });
    const { prismaService } = createMockPrismaService(tx);

    const result = await bootstrapPlatformAdmin(
      { prismaService, passwordService, clock, uuid },
      { email: 'Admin@Example.TEST ', password: 'correct horse battery staple' },
    );

    expect(result).toEqual({ outcome: 'noop', userId: 'existing-admin-id' });
    expect(tx.user.create).not.toHaveBeenCalled();
    expect(tx.authCredential.create).not.toHaveBeenCalled();
  });

  it('refuses to create a second admin when one already exists with a different email', async () => {
    const tx = createMockTx({ id: 'existing-admin-id', normalizedEmail: 'first-admin@example.test' });
    const { prismaService } = createMockPrismaService(tx);

    await expect(
      bootstrapPlatformAdmin(
        { prismaService, passwordService, clock, uuid },
        { email: 'second-admin@example.test', password: 'correct horse battery staple' },
      ),
    ).rejects.toBeInstanceOf(PlatformAdminAlreadyExistsError);

    expect(tx.user.create).not.toHaveBeenCalled();
    expect(tx.authCredential.create).not.toHaveBeenCalled();
  });

  it('rejects a password that fails the same policy normal activation enforces, before opening a transaction', async () => {
    const tx = createMockTx(null);
    const { prismaService, transaction } = createMockPrismaService(tx);

    await expect(
      bootstrapPlatformAdmin(
        { prismaService, passwordService, clock, uuid },
        { email: 'admin@example.test', password: 'too-short' },
      ),
    ).rejects.toBeInstanceOf(PasswordPolicyError);

    expect(transaction).not.toHaveBeenCalled();
  });
});
