import { Inject, Injectable } from '@nestjs/common';
import type {
  AccountActivationPurpose,
  AccountActivationToken,
} from '../../../../.generated/prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import type { AuthRuntimeConfig } from '../auth.config';
import { AUTH_RUNTIME_CONFIG } from '../auth.constants';
import {
  ActivationTokenConsumedError,
  ActivationTokenExpiredError,
  ActivationTokenInvalidError,
} from '../errors/auth.errors';
import type { PrismaTransactionClient } from '../types/prisma-transaction.type';
import type { IssueActivationTokenInput, IssuedOneTimeToken } from '../types/auth.types';
import { ClockService } from './clock.service';
import { TokenCryptoService } from './token-crypto.service';
import { UuidV7Service } from './uuid-v7.service';

/**
 * Shared `pg_advisory_xact_lock` namespace for every operation that can move an account's
 * activation-token/credential state, keyed on the target `User.id`: token consumption here
 * (`consumeWithinTransaction`) and Instructor activation reissue
 * (`InstructorOnboardingService.reissueActivation`) both acquire this same lock, as their first
 * transactional step, before reading anything. `StudentDeviceService.lockStudentDeviceState`
 * uses namespace 0 and `quiz-publishability.util.ts`'s `lockQuizPublicationBoundary` uses
 * namespace 1 — this reserves namespace 2 for the same reason those keep their own: purely
 * developer clarity, not collision avoidance (every lock id across all three is a UUID from the
 * single globally-unique `User`/`StudentDevice`/`Quiz` id spaces).
 *
 * Why consumption must participate, not just reissue: reissue alone acquiring this lock provides
 * no mutual exclusion at all against a concurrent activation that never tries to acquire it —
 * advisory locks only serialize the transactions that actually request them. Without this,
 * "Instructor activates with token A" and "Admin reissues, revoking token A and issuing token B"
 * can interleave so that reissue's own credential check (correctly taken after its lock) reads
 * "not yet activated" a moment before the concurrent activation commits, then reissue's revoke-
 * of-A silently matches zero rows (A was already consumed) and it issues B regardless — leaving
 * an activated Instructor with a freshly issued, nominally "outstanding" token B. `activateAccount`
 * would still refuse to ever honor B (it re-checks credential existence after consuming a token
 * and rolls back if one already exists), so B could never actually establish or alter a
 * credential — but it would sit in the database misrepresenting itself as a live, reissuable
 * activation path, and the Admin who "successfully" reissued it would hand out a code that can
 * never work. Both sides acquiring the same lock first closes this at the root: whichever
 * transaction gets the lock runs to completion before the other's matching read of the token/
 * credential state, so that read is always fresh.
 */
export const ACCOUNT_ACTIVATION_ADVISORY_LOCK_NAMESPACE = 2;

@Injectable()
export class AccountActivationTokenService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly clock: ClockService,
    private readonly tokenCrypto: TokenCryptoService,
    private readonly uuid: UuidV7Service,
    @Inject(AUTH_RUNTIME_CONFIG)
    private readonly config: AuthRuntimeConfig,
  ) {}

  async issue(input: IssueActivationTokenInput): Promise<IssuedOneTimeToken> {
    return this.prismaService.client.$transaction(async (tx) => {
      return this.issueWithinTransaction(tx, input);
    });
  }

  async issueWithinTransaction(
    tx: PrismaTransactionClient,
    input: IssueActivationTokenInput,
  ): Promise<IssuedOneTimeToken> {
    const now = this.clock.now();
    const expiresAt = addSeconds(
      now,
      input.expiresInSeconds ?? this.config.oneTimeTokenTtlSeconds.activation,
    );
    const rawToken = this.tokenCrypto.generateOpaqueToken();
    const tokenHash = this.tokenCrypto.hashOpaqueToken(rawToken);
    const id = this.uuid.create();

    await tx.accountActivationToken.updateMany({
      where: {
        userId: input.userId,
        purpose: input.purpose,
        consumedAt: null,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      data: { revokedAt: now },
    });

    await tx.accountActivationToken.create({
      data: {
        id,
        userId: input.userId,
        purpose: input.purpose,
        tenantId: input.tenantId ?? null,
        initiatedByUserId: input.initiatedByUserId ?? null,
        tokenHash,
        expiresAt,
        createdAt: now,
      },
    });

    return { id, rawToken, tokenHash, expiresAt };
  }

  async consume(
    rawToken: string,
    expectedPurpose?: AccountActivationPurpose,
  ): Promise<AccountActivationToken> {
    const tokenHash = this.tokenCrypto.hashOpaqueToken(rawToken);

    return this.prismaService.client.$transaction(async (tx) => {
      return this.consumeWithinTransaction(tx, tokenHash, expectedPurpose);
    });
  }

  async consumeWithinTransaction(
    tx: PrismaTransactionClient,
    tokenHash: string,
    expectedPurpose?: AccountActivationPurpose,
  ): Promise<AccountActivationToken> {
    const now = this.clock.now();

    // Unlocked lookup only to resolve which User this token belongs to - the lock this method
    // must hold is keyed on that userId, and there is nothing to serialize against for a
    // tokenHash that does not resolve to a real row at all (a forged/mistyped code can never
    // race a concurrent, legitimate operation for some other real account).
    const lookup = await tx.accountActivationToken.findUnique({ where: { tokenHash } });

    if (!lookup) {
      throw new ActivationTokenInvalidError();
    }

    // See ACCOUNT_ACTIVATION_ADVISORY_LOCK_NAMESPACE's own doc comment: this is the other half of
    // the same lock InstructorOnboardingService.reissueActivation acquires. Consumption must
    // participate too, not just reissue - otherwise reissue's lock provides no real mutual
    // exclusion at all against a concurrent activation that never tries to acquire it.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lookup.userId}, ${ACCOUNT_ACTIVATION_ADVISORY_LOCK_NAMESPACE}::bigint))`;

    // Re-read now that the lock is held: the world may have changed between the unlocked lookup
    // above and the moment this transaction actually acquired the lock - e.g. a concurrent
    // reissue could have revoked this exact token and already committed while this transaction
    // was blocked waiting. Every check below runs against this fresh, lock-protected read, never
    // the earlier unlocked one.
    const token = await tx.accountActivationToken.findUnique({ where: { tokenHash } });

    this.assertConsumable(token, now, expectedPurpose);

    const result = await tx.accountActivationToken.updateMany({
      where: {
        id: token.id,
        consumedAt: null,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      data: { consumedAt: now },
    });

    if (result.count !== 1) {
      throw new ActivationTokenConsumedError();
    }

    return {
      ...token,
      consumedAt: now,
    };
  }

  private assertConsumable(
    token: AccountActivationToken | null,
    now: Date,
    expectedPurpose?: AccountActivationPurpose,
  ): asserts token is AccountActivationToken {
    if (!token || token.revokedAt) {
      throw new ActivationTokenInvalidError();
    }

    if (expectedPurpose && token.purpose !== expectedPurpose) {
      throw new ActivationTokenInvalidError();
    }

    if (token.consumedAt) {
      throw new ActivationTokenConsumedError();
    }

    if (token.expiresAt <= now) {
      throw new ActivationTokenExpiredError();
    }
  }
}

function addSeconds(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * 1_000);
}
