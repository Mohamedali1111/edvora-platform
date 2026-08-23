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
