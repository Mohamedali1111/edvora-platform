import { ApiClient } from '@/lib/api/client';
import { ApiError } from '@/lib/api/errors';
import { clearSession, readSession, writeSession } from './session-storage';
import { AccessTokenStore } from './token-store';
import type { AuthenticatedSessionResponse, CurrentUserSummary, MobileSession } from './auth-types';

export const tokenStore = new AccessTokenStore();

let refreshPromise: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  // Coalesce concurrent 401s (e.g. two protected requests firing at once after the
  // access token expired) into a single /auth/refresh call, exactly like the web
  // AuthService — otherwise both requests would race to rotate the same refresh
  // token and one would lose to REFRESH_REPLAY_DETECTED.
  if (!refreshPromise) {
    refreshPromise = performRefresh().finally(() => {
      refreshPromise = null;
    });
  }

  return refreshPromise;
}

async function performRefresh(): Promise<string | null> {
  const stored = await readSession();

  if (!stored) {
    return null;
  }

  try {
    const session = await apiClient.request<AuthenticatedSessionResponse>('/auth/refresh', {
      method: 'POST',
      auth: false,
      retryOnUnauthorized: false,
      body: { channel: 'MOBILE', sessionId: stored.sessionId, refreshToken: stored.refreshToken },
    });

    await persistMobileSession(session);
    return session.accessToken;
  } catch (error: unknown) {
    if (error instanceof ApiError && error.kind === 'network') {
      // The backend never got a chance to say the session is invalid — keep the
      // stored refresh session so the next attempt (e.g. after connectivity
      // returns) can still succeed, instead of forcing an unnecessary re-login.
      throw error;
    }

    // Anything else (INVALID_REFRESH_SESSION, REFRESH_REPLAY_DETECTED,
    // ACCOUNT_UNAVAILABLE, ...) means this refresh session is genuinely done.
    await clearSession();
    tokenStore.set(null);
    return null;
  }
}

export const apiClient = new ApiClient({
  getAccessToken: () => tokenStore.get(),
  setAccessToken: (token) => tokenStore.set(token),
  refresh: refreshAccessToken,
});

function assertMobileSession(session: AuthenticatedSessionResponse): MobileSession {
  if (!session.refreshToken || !session.refreshTokenExpiresAt) {
    throw new ApiError({
      kind: 'parse',
      code: 'INVALID_SESSION_RESPONSE',
      message: 'The API returned a session without a mobile refresh token.',
    });
  }

  return session as MobileSession;
}

async function persistMobileSession(session: AuthenticatedSessionResponse): Promise<void> {
  const mobileSession = assertMobileSession(session);
  tokenStore.set(mobileSession.accessToken);
  await writeSession({ sessionId: mobileSession.sessionId, refreshToken: mobileSession.refreshToken });
}

export async function login(email: string, password: string): Promise<void> {
  const session = await apiClient.request<AuthenticatedSessionResponse>('/auth/login', {
    method: 'POST',
    auth: false,
    body: { email, password, channel: 'MOBILE' },
  });

  await persistMobileSession(session);
}

export async function activateAccount(input: {
  activationToken: string;
  newPassword: string;
}): Promise<void> {
  await apiClient.request<void>('/auth/activate', {
    method: 'POST',
    auth: false,
    body: {
      activationToken: input.activationToken,
      purpose: 'STUDENT_ACTIVATION',
      newPassword: input.newPassword,
    },
  });
}

export async function getCurrentUser(): Promise<CurrentUserSummary> {
  return apiClient.request<CurrentUserSummary>('/auth/me');
}

export async function bootstrapFromStoredSession(): Promise<boolean> {
  if (tokenStore.get()) {
    return true;
  }

  const accessToken = await refreshAccessToken();
  return accessToken !== null;
}

export async function logout(): Promise<void> {
  try {
    if (tokenStore.get()) {
      await apiClient.request<void>('/auth/logout', { method: 'POST', retryOnUnauthorized: false });
    }
  } finally {
    tokenStore.set(null);
    await clearSession();
  }
}
