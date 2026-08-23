import { Inject, Injectable } from '@nestjs/common';
import type { PasswordResetToken } from '../../../../.generated/prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import type { AuthRuntimeConfig } from '../auth.config';
import { AUTH_RUNTIME_CONFIG } from '../auth.constants';
import {
  ResetTokenConsumedError,
  ResetTokenExpiredError,
  ResetTokenInvalidError,
} from '../errors/auth.errors';
import type { IssuedOneTimeToken, IssuePasswordResetTokenInput } from '../types/auth.types';
import { ClockService } from './clock.service';
import { TokenCryptoService } from './token-crypto.service';
import { UuidV7Service } from './uuid-v7.service';

@Injectable()
export class PasswordResetTokenService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly clock: ClockService,
    private readonly tokenCrypto: TokenCryptoService,
    private readonly uuid: UuidV7Service,
    @Inject(AUTH_RUNTIME_CONFIG)
    private readonly config: AuthRuntimeConfig,
  ) {}

  async issue(input: IssuePasswordResetTokenInput): Promise<IssuedOneTimeToken> {
    return this.prismaService.client.$transaction(async (tx) => {
      const now = this.clock.now();
      const expiresAt = addSeconds(
        now,
        input.expiresInSeconds ?? this.config.oneTimeTokenTtlSeconds.passwordReset,
      );
      const rawToken = this.tokenCrypto.generateOpaqueToken();
      const tokenHash = this.tokenCrypto.hashOpaqueToken(rawToken);
      const id = this.uuid.create();

      await tx.passwordResetToken.updateMany({
        where: {
          userId: input.userId,
          consumedAt: null,
          revokedAt: null,
          expiresAt: { gt: now },
        },
        data: { revokedAt: now },
      });

      await tx.passwordResetToken.create({
        data: {
          id,
          userId: input.userId,
          initiatedByUserId: input.initiatedByUserId ?? null,
          tokenHash,
          expiresAt,
          createdAt: now,
        },
      });

      return { id, rawToken, tokenHash, expiresAt };
    });
  }

  async consume(rawToken: string): Promise<PasswordResetToken> {
    const tokenHash = this.tokenCrypto.hashOpaqueToken(rawToken);

    return this.prismaService.client.$transaction(async (tx) => {
      const now = this.clock.now();
      const token = await tx.passwordResetToken.findUnique({ where: { tokenHash } });

      this.assertConsumable(token, now);

      const result = await tx.passwordResetToken.updateMany({
        where: {
          id: token.id,
          consumedAt: null,
          revokedAt: null,
          expiresAt: { gt: now },
        },
        data: { consumedAt: now },
      });

      if (result.count !== 1) {
        throw new ResetTokenConsumedError();
      }

      return {
        ...token,
        consumedAt: now,
      };
    });
  }

  private assertConsumable(
    token: PasswordResetToken | null,
    now: Date,
  ): asserts token is PasswordResetToken {
    if (!token || token.revokedAt) {
      throw new ResetTokenInvalidError();
    }

    if (token.consumedAt) {
      throw new ResetTokenConsumedError();
    }

    if (token.expiresAt <= now) {
      throw new ResetTokenExpiredError();
    }
  }
}

function addSeconds(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * 1_000);
}
