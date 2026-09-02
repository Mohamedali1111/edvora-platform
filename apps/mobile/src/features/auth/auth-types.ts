// Mirrors apps/api/src/modules/auth/auth.controller.ts's response shapes and
// apps/api/src/modules/auth/types/auth.types.ts's CurrentUserSummary exactly.
// Student Mobile only ever sends channel: "MOBILE".

export type PlatformRole = 'STUDENT' | 'INSTRUCTOR' | 'PLATFORM_ADMIN';

export type LanguagePreference = 'EN' | 'AR';

export type AuthenticatedSessionResponse = {
  accessToken: string;
  accessTokenExpiresAt: string;
  sessionId: string;
  refreshToken?: string;
  refreshTokenExpiresAt?: string;
  user: {
    id: string;
    role: PlatformRole;
  };
};

export type CurrentUserSummary = {
  userId: string;
  role: PlatformRole;
  email: string;
  displayName: string | null;
  preferredLanguage: LanguagePreference;
};

// The mobile channel's /auth/login and /auth/refresh always echo refreshToken +
// refreshTokenExpiresAt (see AuthController.toSessionResponse's MOBILE branch) —
// this narrows AuthenticatedSessionResponse to reflect that guarantee once received.
export type MobileSession = AuthenticatedSessionResponse & {
  refreshToken: string;
  refreshTokenExpiresAt: string;
};

export type StoredSession = {
  sessionId: string;
  refreshToken: string;
};

export type AccountActivationPurpose = 'STUDENT_ACTIVATION';
