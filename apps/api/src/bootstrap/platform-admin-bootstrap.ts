import { isEmail } from 'class-validator';
import { AccountStatus, CredentialType, PlatformRole } from '../../.generated/prisma/client';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { normalizeEmailForLookup } from '../modules/auth/email-normalization';
import { ClockService } from '../modules/auth/services/clock.service';
import { PasswordService } from '../modules/auth/services/password.service';
import { UuidV7Service } from '../modules/auth/services/uuid-v7.service';
import {
  BootstrapEmailInvalidError,
  BootstrapEmailRequiredError,
  BootstrapPasswordRequiredError,
  PlatformAdminAlreadyExistsError,
} from './platform-admin-bootstrap.errors';

// Fixed lock key: every invocation of this tool, regardless of the requested email, contends
// for the same lock. This is what makes "at most one initial PLATFORM_ADMIN" hold even when
// two operators (or one operator, twice, e.g. a double-invoked CI/manual step) run the
// bootstrap at the same moment - see bootstrapPlatformAdmin below for how it is used.
const PLATFORM_ADMIN_BOOTSTRAP_LOCK_KEY = 'platform-admin:bootstrap';
const DEFAULT_DISPLAY_NAME = 'Platform Admin';

export type PlatformAdminBootstrapInput = {
  email: string;
  password: string;
};

export type PlatformAdminBootstrapOutcome =
  | { outcome: 'created'; userId: string }
  | { outcome: 'noop'; userId: string };

export type PlatformAdminBootstrapDeps = {
  prismaService: PrismaService;
  passwordService: PasswordService;
  clock: ClockService;
  uuid: UuidV7Service;
};

/**
 * Reads and validates this tool's two dedicated bootstrap variables from the environment.
 * Deliberately env-var-only (no interactive/stdin prompt): this repository has no existing
 * secure CLI-input pattern to build on, and environment variables are what makes this
 * predictably runnable as a single manual command against Railway (e.g. `railway run pnpm
 * --filter @edvora/api admin:bootstrap`). `PLATFORM_ADMIN_BOOTSTRAP_PASSWORD` is intentionally
 * its own variable, never a fallback to any normal runtime AUTH secret.
 */
export function readPlatformAdminBootstrapInput(
  env: NodeJS.ProcessEnv = process.env,
): PlatformAdminBootstrapInput {
  const email = env.PLATFORM_ADMIN_BOOTSTRAP_EMAIL?.trim();

  if (!email) {
    throw new BootstrapEmailRequiredError();
  }

  if (!isEmail(email)) {
    throw new BootstrapEmailInvalidError();
  }

  const password = env.PLATFORM_ADMIN_BOOTSTRAP_PASSWORD;

  if (!password) {
    throw new BootstrapPasswordRequiredError();
  }

  return { email, password };
}

/**
 * Creates the platform's first PLATFORM_ADMIN, or safely no-ops/refuses on rerun.
 *
 * - No PLATFORM_ADMIN exists yet: creates exactly one, active and immediately able to log in
 *   through the normal `/auth/login` path (same `accountStatus: ACTIVE` +
 *   `AuthCredential{credentialType: PASSWORD}` shape `AuthOrchestrationService.login` already
 *   checks - no activation token, no minted JWT, no bypass of normal password verification).
 * - A PLATFORM_ADMIN already exists with the same normalized email: no-op. The existing
 *   credential is never read, hashed against, or written - reruns can never silently rotate an
 *   existing admin's password.
 * - A PLATFORM_ADMIN already exists with a different email: refuses
 *   (`PlatformAdminAlreadyExistsError`). This tool only ever seeds the first admin; a second
 *   platform admin is a deliberate administrative action, not something a rerun of this script
 *   should be able to cause.
 *
 * Concurrency: the schema has no partial-unique constraint enforcing "at most one
 * PLATFORM_ADMIN" (one row per `normalizedEmail` is the only global invariant Postgres itself
 * enforces here), so a naive check-then-create could let two concurrent invocations both
 * observe "no admin yet" and both insert one. `pg_advisory_xact_lock`, held for the lifetime of
 * this transaction, closes that window by serializing all bootstrap attempts against each
 * other - the same primitive this codebase already uses for other check-then-write invariants
 * the schema alone cannot express (see e.g. `StudentDeviceService`, `NotificationService`,
 * `student-quiz-attempt.service.ts`). Password hashing happens *before* the transaction opens,
 * so the lock is held only for the row-level decision, not for the CPU-bound argon2id work.
 *
 * Residual limitation (documented, not fixed by this tool): a Postgres partial unique index on
 * `users (platform_role) WHERE platform_role = 'PLATFORM_ADMIN'` would let the database itself
 * refuse a second admin even from a client that bypasses this script's lock entirely (a manual
 * `INSERT`, a future admin-creation code path with a bug in it). That would require a schema
 * migration, which is out of scope for this slice per its instructions - it is reported here as
 * a residual risk, not implemented.
 */
export async function bootstrapPlatformAdmin(
  deps: PlatformAdminBootstrapDeps,
  input: PlatformAdminBootstrapInput,
): Promise<PlatformAdminBootstrapOutcome> {
  const { prismaService, passwordService, clock, uuid } = deps;
  const normalizedEmail = normalizeEmailForLookup(input.email);

  passwordService.assertPasswordPolicy(input.password);
  const passwordHash = await passwordService.hashPassword(input.password);

  return prismaService.client.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${PLATFORM_ADMIN_BOOTSTRAP_LOCK_KEY}, 0::bigint))`;

    const existingAdmin = await tx.user.findFirst({
      where: { platformRole: PlatformRole.PLATFORM_ADMIN },
      select: { id: true, normalizedEmail: true },
      orderBy: { createdAt: 'asc' },
    });

    if (existingAdmin) {
      if (existingAdmin.normalizedEmail === normalizedEmail) {
        return { outcome: 'noop', userId: existingAdmin.id };
      }

      throw new PlatformAdminAlreadyExistsError();
    }

    const userId = uuid.create();
    const now = clock.now();

    await tx.user.create({
      data: {
        id: userId,
        email: input.email.trim(),
        normalizedEmail,
        displayName: DEFAULT_DISPLAY_NAME,
        platformRole: PlatformRole.PLATFORM_ADMIN,
        accountStatus: AccountStatus.ACTIVE,
        createdAt: now,
      },
    });

    await tx.authCredential.create({
      data: {
        id: uuid.create(),
        userId,
        credentialType: CredentialType.PASSWORD,
        passwordHash,
        passwordUpdatedAt: now,
      },
    });

    return { outcome: 'created', userId };
  });
}
