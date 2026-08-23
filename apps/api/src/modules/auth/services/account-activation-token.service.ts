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
    });
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
