/**
 * Manual, one-time PLATFORM_ADMIN bootstrap for a fresh staging/production deployment.
 *
 * This script is NEVER invoked automatically - not on API startup, not from `prisma migrate
 * deploy`, not from any `build`/`start`/`install`/`postinstall` script. An operator runs it by
 * hand, exactly once per environment, against that environment's real DATABASE_URL, e.g.:
 *
 *   railway run pnpm --filter @edvora/api admin:bootstrap
 *
 * See docs/DEPLOYMENT.md ("Bootstrapping the first Platform Admin") for the full runbook,
 * including unsetting the bootstrap variables again immediately after a successful run.
 *
 * Required environment:
 *   DATABASE_URL                       - same variable the API itself requires
 *   AUTH_JWT_SECRET / AUTH_JWT_ISSUER /
 *   AUTH_JWT_AUDIENCE                  - reused only so this tool hashes the bootstrap
 *                                        password with the exact same argon2id configuration
 *                                        the running API uses (createAuthRuntimeConfig); no
 *                                        JWT is ever signed by this script.
 *   PLATFORM_ADMIN_BOOTSTRAP_EMAIL     - manual bootstrap only, not a normal runtime variable.
 *   PLATFORM_ADMIN_BOOTSTRAP_PASSWORD  - manual bootstrap only, not a normal runtime variable;
 *                                        never reused for anything else. A rerun never rotates
 *                                        an already-created admin's password.
 *
 * Output is intentionally minimal: never the requested password, its hash, DATABASE_URL, or
 * any token. See platform-admin-bootstrap.ts for the create/no-op/refuse decision this wraps.
 */
import { createDatabaseRuntimeConfig } from '../src/infrastructure/database/database.config';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { createAuthRuntimeConfig } from '../src/modules/auth/auth.config';
import { AuthError } from '../src/modules/auth/errors/auth.errors';
import { ClockService } from '../src/modules/auth/services/clock.service';
import { PasswordService } from '../src/modules/auth/services/password.service';
import { UuidV7Service } from '../src/modules/auth/services/uuid-v7.service';
import {
  bootstrapPlatformAdmin,
  readPlatformAdminBootstrapInput,
} from '../src/bootstrap/platform-admin-bootstrap';
import { PlatformAdminBootstrapError } from '../src/bootstrap/platform-admin-bootstrap.errors';

async function main(): Promise<void> {
  // Stage 1: pure configuration/input validation. Every error these three calls can throw is a
  // hand-written, fixed string from this repository's own config factories - none of them ever
  // interpolate a secret value (verified: they describe *which* variable is missing/invalid,
  // never its value) - so it is safe to print directly rather than falling back to a generic
  // message.
  let bootstrapInput: ReturnType<typeof readPlatformAdminBootstrapInput>;
  let databaseConfig: ReturnType<typeof createDatabaseRuntimeConfig>;
  let authConfig: ReturnType<typeof createAuthRuntimeConfig>;

  try {
    bootstrapInput = readPlatformAdminBootstrapInput();
    databaseConfig = createDatabaseRuntimeConfig();
    authConfig = createAuthRuntimeConfig();
  } catch (error) {
    reportFailure(error);
    process.exitCode = 1;
    return;
  }

  const prismaService = new PrismaService(databaseConfig);

  // Stage 2: connect. PrismaService.onModuleInit already replaces any underlying driver error
  // with a fixed, connection-string-free message - safe to print as-is.
  try {
    await prismaService.onModuleInit();
  } catch (error) {
    reportFailure(error);
    process.exitCode = 1;
    return;
  }

  try {
    const result = await bootstrapPlatformAdmin(
      {
        prismaService,
        passwordService: new PasswordService(authConfig),
        clock: new ClockService(),
        uuid: new UuidV7Service(),
      },
      bootstrapInput,
    );

    if (result.outcome === 'created') {
      console.log('Platform admin bootstrap completed: a new platform admin was created.');
    } else {
      console.log('Platform admin bootstrap completed: a platform admin with this email already exists (no-op).');
    }
  } catch (error) {
    // Stage 3: the actual create/no-op/refuse decision. Only this tool's own typed errors and
    // the shared PasswordPolicyError (an AuthError - see auth.errors.ts) have a message this
    // script can vouch for; anything else (an unexpected Prisma/driver error) is reported
    // generically rather than risking an unreviewed message reaching the terminal.
    if (error instanceof PlatformAdminBootstrapError || error instanceof AuthError) {
      reportFailure(error);
    } else {
      console.error('Platform admin bootstrap failed due to an unexpected error.');
    }

    process.exitCode = 1;
  } finally {
    await prismaService.onModuleDestroy();
  }
}

function reportFailure(error: unknown): void {
  console.error(`Platform admin bootstrap failed: ${error instanceof Error ? error.message : 'invalid configuration.'}`);
}

main().catch(() => {
  console.error('Platform admin bootstrap failed due to an unexpected error.');
  process.exitCode = 1;
});
