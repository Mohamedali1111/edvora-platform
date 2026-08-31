import { Inject, Injectable } from '@nestjs/common';
import {
  AccountStatus,
  CredentialType,
  PlatformRole,
  RefreshSessionStatus,
  SecurityEventSeverity,
} from '../../../../.generated/prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import type { AuthRuntimeConfig } from '../auth.config';
import { AUTH_RUNTIME_CONFIG } from '../auth.constants';
import { normalizeEmailForLookup } from '../email-normalization';
import {
  AccountInactiveError,
  ActivationTokenInvalidError,
  CurrentPasswordIncorrectError,
  InvalidCredentialsError,
  InvalidRefreshSessionError,
  NewPasswordSameAsCurrentError,
} from '../errors/auth.errors';
import type {
  ActivateAccountInput,
  AuthenticatedSessionResult,
  ChangePasswordInput,
  CompletePasswordResetInput,
  CurrentUserSummary,
  LoginInput,
  RefreshAuthenticatedSessionInput,
} from '../types/auth.types';
import { AccessTokenService } from './access-token.service';
import { AccountActivationTokenService } from './account-activation-token.service';
import { ClockService } from './clock.service';
import { PasswordResetTokenService } from './password-reset-token.service';
import { PasswordService } from './password.service';
import { RefreshSessionService } from './refresh-session.service';
import { SecurityEventService } from './security-event.service';
import { TokenCryptoService } from './token-crypto.service';
import { UuidV7Service } from './uuid-v7.service';

const DUMMY_ARGON2ID_HASH =
  '$argon2id$v=19$m=19456,p=1,t=2$Dsrooch32mUkahobe7RB0Q$qxl4e7wVytmBgqMVfbIVQFXpIUtE7HYuk88DCKpqd9g';

@Injectable()
export class AuthOrchestrationService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly passwordService: PasswordService,
    private readonly accessTokens: AccessTokenService,
    private readonly refreshSessions: RefreshSessionService,
    private readonly activationTokens: AccountActivationTokenService,
    private readonly resetTokens: PasswordResetTokenService,
    private readonly tokenCrypto: TokenCryptoService,
    private readonly securityEvents: SecurityEventService,
    private readonly clock: ClockService,
    private readonly uuid: UuidV7Service,
    @Inject(AUTH_RUNTIME_CONFIG)
    private readonly config: AuthRuntimeConfig,
  ) {}

  async login(input: LoginInput): Promise<AuthenticatedSessionResult> {
    const normalizedEmail = normalizeEmailForLookup(input.email);
    const user = await this.prismaService.client.user.findUnique({
      where: { normalizedEmail },
      select: {
        id: true,
        accountStatus: true,
        platformRole: true,
        authCredentials: {
          where: { credentialType: CredentialType.PASSWORD },
          select: { id: true, passwordHash: true },
          take: 1,
        },
      },
    });

    const credential = user?.authCredentials[0] ?? null;
    const hashToVerify = credential?.passwordHash ?? DUMMY_ARGON2ID_HASH;
    const passwordMatches = await this.passwordService.verifyPassword(input.password, hashToVerify);

    if (!user || !credential || !passwordMatches) {
      await this.recordFailedLogin(normalizedEmail);
      throw new InvalidCredentialsError();
    }

    this.assertActiveAccount(user.accountStatus);

    const passwordHash =
      this.passwordService.needsRehash(credential.passwordHash)
        ? await this.passwordService.hashPassword(input.password)
        : null;

    const result = await this.prismaService.client.$transaction(async (tx) => {
      if (passwordHash) {
        await tx.authCredential.update({
          where: { id: credential.id },
          data: {
            passwordHash,
            passwordUpdatedAt: this.clock.now(),
          },
        });
      }

      const refreshSession = await this.refreshSessions.createSessionWithinTransaction(tx, {
        userId: user.id,
        channel: input.channel,
      });

      return this.issueAuthenticatedSession({
        userId: user.id,
        platformRole: user.platformRole,
        sessionId: refreshSession.sessionId,
        refreshToken: refreshSession.refreshToken,
        refreshTokenExpiresAt: refreshSession.expiresAt,
      });
    });

    await this.securityEvents.recordBestEffort({
      eventType: 'LOGIN_SUCCEEDED',
      actorUserId: user.id,
      targetUserId: user.id,
      sessionId: result.sessionId,
    });

    return result;
  }

  /**
   * `/auth/me`: resolves the current user fresh from the database by the authenticated
   * principal's ID — never echoes JWT claims directly, since a short-lived access token can
   * outlive an account being suspended/deletion-requested/deleted in the meantime. Reuses the
   * exact same `assertActiveAccount` gate every other authenticated flow (login, refresh,
   * activate, change-password) already applies — no parallel account-status policy. A missing row
   * is treated identically to an inactive one (`AccountInactiveError`, mapped to the same generic
   * `403 ACCOUNT_UNAVAILABLE` the client already handles elsewhere) rather than a distinct
   * "not found," since a valid signed token resolving to no row and one resolving to a suspended
   * account carry no legitimate distinction worth exposing.
   */
  async getCurrentUser(userId: string): Promise<CurrentUserSummary> {
    const user = await this.prismaService.client.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        displayName: true,
        platformRole: true,
        preferredLanguage: true,
        accountStatus: true,
      },
    });

    if (!user) {
      throw new AccountInactiveError();
    }

    this.assertActiveAccount(user.accountStatus);

    return {
      userId: user.id,
      role: user.platformRole,
      email: user.email,
      displayName: user.displayName,
      preferredLanguage: user.preferredLanguage,
    };
  }

  async activateAccount(input: ActivateAccountInput): Promise<{ userId: string; platformRole: PlatformRole }> {
    this.passwordService.assertPasswordPolicy(input.newPassword);
    const tokenHash = this.tokenCrypto.hashOpaqueToken(input.activationToken);
    const passwordHash = await this.passwordService.hashPassword(input.newPassword);

    return this.prismaService.client.$transaction(async (tx) => {
      const token = await this.activationTokens.consumeWithinTransaction(
        tx,
        tokenHash,
        input.expectedPurpose,
      );
      const user = await tx.user.findUnique({
        where: { id: token.userId },
        select: {
          id: true,
          accountStatus: true,
          platformRole: true,
          authCredentials: {
            where: { credentialType: CredentialType.PASSWORD },
            select: { id: true },
            take: 1,
          },
        },
      });

      if (!user) {
        throw new ActivationTokenInvalidError();
      }

      this.assertActiveAccount(user.accountStatus);

      if (user.authCredentials.length > 0) {
        throw new ActivationTokenInvalidError();
      }

      await tx.authCredential.create({
        data: {
          id: this.uuid.create(),
          userId: user.id,
          credentialType: CredentialType.PASSWORD,
          passwordHash,
          passwordUpdatedAt: this.clock.now(),
        },
      });

      await this.securityEvents.recordWithinTransaction(tx, {
        eventType: 'ACCOUNT_ACTIVATED',
        actorUserId: user.id,
        targetUserId: user.id,
        tenantId: token.tenantId,
      });

      return { userId: user.id, platformRole: user.platformRole };
    });
  }

  async refreshAuthenticatedSession(
    input: RefreshAuthenticatedSessionInput,
  ): Promise<AuthenticatedSessionResult> {
    try {
      const rotated = await this.refreshSessions.rotateSession(input);
      const session = await this.prismaService.client.refreshSession.findUnique({
        where: { id: rotated.sessionId },
        select: {
          userId: true,
          user: {
            select: {
              accountStatus: true,
              platformRole: true,
            },
          },
        },
      });

      if (!session) {
        throw new InvalidRefreshSessionError();
      }

      this.assertActiveAccount(session.user.accountStatus);

      return this.issueAuthenticatedSession({
        userId: session.userId,
        platformRole: session.user.platformRole,
        sessionId: rotated.sessionId,
        refreshToken: rotated.refreshToken,
        refreshTokenExpiresAt: rotated.expiresAt,
      });
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'RefreshReplayDetectedError') {
        await this.securityEvents.recordBestEffort({
          eventType: 'SESSION_REFRESH_REPLAY_DETECTED',
          severity: SecurityEventSeverity.HIGH,
          sessionId: input.sessionId,
        });
      }

      throw error;
    }
  }

  async logout(input: { userId: string; sessionId: string }): Promise<void> {
    await this.prismaService.client.refreshSession.updateMany({
      where: {
        id: input.sessionId,
        userId: input.userId,
      },
      data: {
        status: RefreshSessionStatus.REVOKED,
        revokedAt: this.clock.now(),
      },
    });

    await this.securityEvents.recordBestEffort({
      eventType: 'LOGOUT',
      actorUserId: input.userId,
      targetUserId: input.userId,
      sessionId: input.sessionId,
    });
  }

  async logoutAll(input: { userId: string }): Promise<number> {
    const revokedCount = await this.refreshSessions.revokeAllUserSessions(input.userId);
    await this.securityEvents.recordBestEffort({
      eventType: 'LOGOUT_ALL',
      actorUserId: input.userId,
      targetUserId: input.userId,
    });

    return revokedCount;
  }

  async changePassword(input: ChangePasswordInput): Promise<AuthenticatedSessionResult> {
    this.passwordService.assertPasswordPolicy(input.newPassword);

    const user = await this.prismaService.client.user.findUnique({
      where: { id: input.userId },
      select: {
        id: true,
        accountStatus: true,
        platformRole: true,
        authCredentials: {
          where: { credentialType: CredentialType.PASSWORD },
          select: { id: true, passwordHash: true },
          take: 1,
        },
      },
    });
    const credential = user?.authCredentials[0] ?? null;

    if (!user || !credential) {
      throw new CurrentPasswordIncorrectError();
    }

    this.assertActiveAccount(user.accountStatus);

    const currentMatches = await this.passwordService.verifyPassword(
      input.currentPassword,
      credential.passwordHash,
    );

    if (!currentMatches) {
      throw new CurrentPasswordIncorrectError();
    }

    const samePassword = await this.passwordService.verifyPassword(
      input.newPassword,
      credential.passwordHash,
    );

    if (samePassword) {
      throw new NewPasswordSameAsCurrentError();
    }

    const newPasswordHash = await this.passwordService.hashPassword(input.newPassword);

    return this.prismaService.client.$transaction(async (tx) => {
      await tx.authCredential.update({
        where: { id: credential.id },
        data: {
          passwordHash: newPasswordHash,
          passwordUpdatedAt: this.clock.now(),
        },
      });
      await this.refreshSessions.revokeAllUserSessionsWithinTransaction(
        tx,
        input.userId,
        input.currentSessionId,
      );
      const nextSession = await this.refreshSessions.rotateAuthenticatedSessionWithinTransaction(tx, {
        userId: input.userId,
        sessionId: input.currentSessionId,
      });
      await this.securityEvents.recordWithinTransaction(tx, {
        eventType: 'PASSWORD_CHANGED',
        actorUserId: input.userId,
        targetUserId: input.userId,
        sessionId: input.currentSessionId,
      });

      return this.issueAuthenticatedSession({
        userId: user.id,
        platformRole: user.platformRole,
        sessionId: nextSession.sessionId,
        refreshToken: nextSession.refreshToken,
        refreshTokenExpiresAt: nextSession.expiresAt,
      });
    });
  }

  async completePasswordReset(input: CompletePasswordResetInput): Promise<{ userId: string }> {
    this.passwordService.assertPasswordPolicy(input.newPassword);
    const tokenHash = this.tokenCrypto.hashOpaqueToken(input.resetToken);
    const passwordHash = await this.passwordService.hashPassword(input.newPassword);

    return this.prismaService.client.$transaction(async (tx) => {
      const token = await this.resetTokens.consumeWithinTransaction(tx, tokenHash);
      const user = await tx.user.findUnique({
        where: { id: token.userId },
        select: {
          id: true,
          accountStatus: true,
        },
      });

      if (!user) {
        throw new InvalidCredentialsError();
      }

      this.assertActiveAccount(user.accountStatus);

      await tx.authCredential.upsert({
        where: {
          userId_credentialType: {
            userId: user.id,
            credentialType: CredentialType.PASSWORD,
          },
        },
        create: {
          id: this.uuid.create(),
          userId: user.id,
          credentialType: CredentialType.PASSWORD,
          passwordHash,
          passwordUpdatedAt: this.clock.now(),
        },
        update: {
          passwordHash,
          passwordUpdatedAt: this.clock.now(),
        },
      });
      await this.refreshSessions.revokeAllUserSessionsWithinTransaction(tx, user.id);
      await this.securityEvents.recordWithinTransaction(tx, {
        eventType: 'PASSWORD_RESET_COMPLETED',
        actorUserId: user.id,
        targetUserId: user.id,
      });

      return { userId: user.id };
    });
  }

  private async issueAuthenticatedSession(input: {
    userId: string;
    platformRole: PlatformRole;
    sessionId: string;
    refreshToken: string;
    refreshTokenExpiresAt: Date;
  }): Promise<AuthenticatedSessionResult> {
    const accessToken = await this.accessTokens.sign({
      userId: input.userId,
      sessionId: input.sessionId,
      platformRole: input.platformRole,
    });

    return {
      user: {
        userId: input.userId,
        platformRole: input.platformRole,
      },
      sessionId: input.sessionId,
      accessToken,
      refreshToken: input.refreshToken,
      accessTokenTtlSeconds: this.config.jwt.accessTokenTtlSeconds,
      refreshTokenExpiresAt: input.refreshTokenExpiresAt,
    };
  }

  private assertActiveAccount(status: AccountStatus): void {
    if (status !== AccountStatus.ACTIVE) {
      throw new AccountInactiveError();
    }
  }

  private async recordFailedLogin(normalizedEmail: string): Promise<void> {
    await this.securityEvents.recordBestEffort({
      eventType: 'LOGIN_FAILED',
      severity: SecurityEventSeverity.WARN,
      metadata: {
        normalizedEmailHash: this.tokenCrypto.hashOpaqueToken(normalizedEmail),
      },
    });
  }
}
