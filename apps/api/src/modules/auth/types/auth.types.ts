import type { AccountActivationPurpose, PlatformRole } from '../../../../.generated/prisma/client';

export type SessionChannel = 'MOBILE' | 'WEB';

export type AccessTokenPayload = {
  sub: string;
  sid: string;
  role: PlatformRole;
  iat: number;
  exp: number;
  iss: string;
  aud: string;
};

export type SignAccessTokenInput = {
  userId: string;
  sessionId: string;
  platformRole: PlatformRole;
};

export type IssuedRefreshSession = {
  sessionId: string;
  refreshToken: string;
  refreshTokenHash: string;
  expiresAt: Date;
};

export type RotatedRefreshSession = {
  sessionId: string;
  refreshToken: string;
  refreshTokenHash: string;
  expiresAt: Date;
};

export type IssueActivationTokenInput = {
  userId: string;
  purpose: AccountActivationPurpose;
  tenantId?: string | null;
  initiatedByUserId?: string | null;
  expiresInSeconds?: number;
};

export type IssuePasswordResetTokenInput = {
  userId: string;
  initiatedByUserId?: string | null;
  expiresInSeconds?: number;
};

export type IssuedOneTimeToken = {
  id: string;
  rawToken: string;
  tokenHash: string;
  expiresAt: Date;
};

export type AuthenticatedSessionResult = {
  user: {
    userId: string;
    platformRole: PlatformRole;
  };
  sessionId: string;
  accessToken: string;
  refreshToken: string;
  accessTokenTtlSeconds: number;
  refreshTokenExpiresAt: Date;
};

export type LoginInput = {
  email: string;
  password: string;
  channel: SessionChannel;
};

export type ActivateAccountInput = {
  activationToken: string;
  newPassword: string;
  expectedPurpose: AccountActivationPurpose;
};

export type RefreshAuthenticatedSessionInput = {
  sessionId: string;
  refreshToken: string;
};

export type ChangePasswordInput = {
  userId: string;
  currentSessionId: string;
  currentPassword: string;
  newPassword: string;
};

export type CompletePasswordResetInput = {
  resetToken: string;
  newPassword: string;
};
