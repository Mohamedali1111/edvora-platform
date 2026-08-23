import { Injectable } from '@nestjs/common';
import {
  AccountStatus,
  Prisma,
  RefreshSessionStatus,
  type RefreshSession,
} from '../../../../.generated/prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { AccountInactiveError, InvalidRefreshSessionError, RefreshReplayDetectedError } from '../errors/auth.errors';
import type { IssuedRefreshSession, RotatedRefreshSession, SessionChannel } from '../types/auth.types';
import { AuthRuntimeConfig } from '../auth.config';
import { AUTH_RUNTIME_CONFIG } from '../auth.constants';
import type { PrismaTransactionClient } from '../types/prisma-transaction.type';
import { Inject } from '@nestjs/common';
import { ClockService } from './clock.service';
import { TokenCryptoService } from './token-crypto.service';
import { UuidV7Service } from './uuid-v7.service';

const CONCURRENT_RETRY_GRACE_MILLISECONDS = 5_000;

type RefreshSessionWithUser = RefreshSession & {
  user: {
    accountStatus: AccountStatus;
  };
};

@Injectable()
export class RefreshSessionService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly clock: ClockService,
    private readonly tokenCrypto: TokenCryptoService,
    private readonly uuid: UuidV7Service,
    @Inject(AUTH_RUNTIME_CONFIG)
    private readonly config: AuthRuntimeConfig,
  ) {}

  async createSession(input: {
    userId: string;
    channel: SessionChannel;
    deviceId?: string | null;
  }): Promise<IssuedRefreshSession> {
    return this.prismaService.client.$transaction((tx) => {
      return this.createSessionWithinTransaction(tx, input);
    });
  }

  async createSessionWithinTransaction(
    tx: PrismaTransactionClient,
    input: {
      userId: string;
      channel: SessionChannel;
      deviceId?: string | null;
    },
  ): Promise<IssuedRefreshSession> {
    const now = this.clock.now();
    const user = await tx.user.findUnique({
      where: { id: input.userId },
      select: { accountStatus: true },
    });

    if (!user || user.accountStatus !== AccountStatus.ACTIVE) {
      throw new AccountInactiveError();
    }

    const refreshToken = this.tokenCrypto.generateOpaqueToken();
    const refreshTokenHash = this.tokenCrypto.hashOpaqueToken(refreshToken);
    const expiresAt = addSeconds(now, this.getRefreshTtlSeconds(input.channel));
    const sessionId = this.uuid.create();

    await tx.refreshSession.create({
      data: {
        id: sessionId,
        userId: input.userId,
        deviceId: input.deviceId ?? null,
        status: RefreshSessionStatus.ACTIVE,
        refreshTokenHash,
        expiresAt,
      },
    });

    return {
      sessionId,
      refreshToken,
      refreshTokenHash,
      expiresAt,
    };
  }

  async rotateSession(input: {
    sessionId: string;
    refreshToken: string;
  }): Promise<RotatedRefreshSession> {
    const presentedHash = this.tokenCrypto.hashOpaqueToken(input.refreshToken);

    const result = await this.prismaService.client.$transaction(async (tx) => {
      const now = this.clock.now();
      const session = await tx.refreshSession.findUnique({
        where: { id: input.sessionId },
        include: {
          user: {
            select: { accountStatus: true },
          },
        },
      });

      this.assertSessionUsable(session, now);

      if (!this.tokenCrypto.timingSafeEqualHex(session.refreshTokenHash, presentedHash)) {
        return this.handleHashMismatch(tx, session, now);
      }

      const nextRefreshToken = this.tokenCrypto.generateOpaqueToken();
      const nextRefreshTokenHash = this.tokenCrypto.hashOpaqueToken(nextRefreshToken);

      const result = await tx.refreshSession.updateMany({
        where: {
          id: input.sessionId,
          status: RefreshSessionStatus.ACTIVE,
          refreshTokenHash: presentedHash,
          expiresAt: { gt: now },
          revokedAt: null,
        },
        data: {
          refreshTokenHash: nextRefreshTokenHash,
          lastUsedAt: now,
        },
      });

      if (result.count !== 1) {
        const current = await tx.refreshSession.findUnique({ where: { id: input.sessionId } });

        if (current?.lastUsedAt && isWithinGraceWindow(current.lastUsedAt, now)) {
          return { status: 'invalid' } as const;
        }

        if (current?.status === RefreshSessionStatus.ACTIVE) {
          await tx.refreshSession.update({
            where: { id: input.sessionId },
            data: {
              status: RefreshSessionStatus.REVOKED,
              revokedAt: now,
            },
          });
          return { status: 'replay' } as const;
        }

        return { status: 'invalid' } as const;
      }

      return {
        status: 'rotated',
        sessionId: input.sessionId,
        refreshToken: nextRefreshToken,
        refreshTokenHash: nextRefreshTokenHash,
        expiresAt: session.expiresAt,
      } as const;
    });

    if (result.status === 'replay') {
      throw new RefreshReplayDetectedError();
    }

    if (result.status === 'invalid') {
      throw new InvalidRefreshSessionError();
    }

    return {
      sessionId: result.sessionId,
      refreshToken: result.refreshToken,
      refreshTokenHash: result.refreshTokenHash,
      expiresAt: result.expiresAt,
    };
  }

  async revokeSession(sessionId: string): Promise<void> {
    const now = this.clock.now();

    await this.prismaService.client.refreshSession.updateMany({
      where: {
        id: sessionId,
        status: RefreshSessionStatus.ACTIVE,
      },
      data: {
        status: RefreshSessionStatus.REVOKED,
        revokedAt: now,
      },
    });
  }

  async revokeAllUserSessions(userId: string, exceptSessionId?: string): Promise<number> {
    const now = this.clock.now();
    const result = await this.prismaService.client.refreshSession.updateMany({
      where: {
        userId,
        status: RefreshSessionStatus.ACTIVE,
        id: exceptSessionId ? { not: exceptSessionId } : undefined,
      },
      data: {
        status: RefreshSessionStatus.REVOKED,
        revokedAt: now,
      },
    });

    return result.count;
  }

  async revokeAllUserSessionsWithinTransaction(
    tx: PrismaTransactionClient,
    userId: string,
    exceptSessionId?: string,
  ): Promise<number> {
    const now = this.clock.now();
    const result = await tx.refreshSession.updateMany({
      where: {
        userId,
        status: RefreshSessionStatus.ACTIVE,
        id: exceptSessionId ? { not: exceptSessionId } : undefined,
      },
      data: {
        status: RefreshSessionStatus.REVOKED,
        revokedAt: now,
      },
    });

    return result.count;
  }

  async rotateAuthenticatedSessionWithinTransaction(
    tx: PrismaTransactionClient,
    input: {
      userId: string;
      sessionId: string;
    },
  ): Promise<RotatedRefreshSession> {
    const now = this.clock.now();
    const session = await tx.refreshSession.findUnique({
      where: { id: input.sessionId },
      include: {
        user: {
          select: { accountStatus: true },
        },
      },
    });

    this.assertSessionUsable(session, now);

    if (session.userId !== input.userId) {
      throw new InvalidRefreshSessionError();
    }

    const nextRefreshToken = this.tokenCrypto.generateOpaqueToken();
    const nextRefreshTokenHash = this.tokenCrypto.hashOpaqueToken(nextRefreshToken);

    const result = await tx.refreshSession.updateMany({
      where: {
        id: input.sessionId,
        userId: input.userId,
        status: RefreshSessionStatus.ACTIVE,
        expiresAt: { gt: now },
        revokedAt: null,
      },
      data: {
        refreshTokenHash: nextRefreshTokenHash,
        lastUsedAt: now,
      },
    });

    if (result.count !== 1) {
      throw new InvalidRefreshSessionError();
    }

    return {
      sessionId: input.sessionId,
      refreshToken: nextRefreshToken,
      refreshTokenHash: nextRefreshTokenHash,
      expiresAt: session.expiresAt,
    };
  }

  private getRefreshTtlSeconds(channel: SessionChannel): number {
    return channel === 'MOBILE'
      ? this.config.refreshSessionTtlSeconds.mobile
      : this.config.refreshSessionTtlSeconds.web;
  }

  private assertSessionUsable(
    session: RefreshSessionWithUser | null,
    now: Date,
  ): asserts session is RefreshSessionWithUser {
    if (!session) {
      throw new InvalidRefreshSessionError();
    }

    if (session.user.accountStatus !== AccountStatus.ACTIVE) {
      throw new AccountInactiveError();
    }

    if (
      session.status !== RefreshSessionStatus.ACTIVE ||
      session.revokedAt !== null ||
      session.expiresAt <= now
    ) {
      throw new InvalidRefreshSessionError();
    }
  }

  private async handleHashMismatch(
    tx: Prisma.TransactionClient,
    session: RefreshSessionWithUser,
    now: Date,
  ): Promise<{ status: 'invalid' } | { status: 'replay' }> {
    if (session.lastUsedAt && isWithinGraceWindow(session.lastUsedAt, now)) {
      return { status: 'invalid' };
    }

    await tx.refreshSession.update({
      where: { id: session.id },
      data: {
        status: RefreshSessionStatus.REVOKED,
        revokedAt: now,
      },
    });

    return { status: 'replay' };
  }
}

function addSeconds(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * 1_000);
}

function isWithinGraceWindow(lastUsedAt: Date, now: Date): boolean {
  return now.getTime() - lastUsedAt.getTime() <= CONCURRENT_RETRY_GRACE_MILLISECONDS;
}
