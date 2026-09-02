import { deleteSecureItem, getSecureItem, setSecureItem } from '@/lib/storage/secure-store';
import type { StoredSession } from './auth-types';

// Two SecureStore keys rather than one JSON blob: a corrupt/partial write to one
// key can't silently produce a session with a valid sessionId and a garbage
// refreshToken (or vice versa) — readSession() requires both to be present.
const REFRESH_TOKEN_KEY = 'edvora.mobile.session.refreshToken';
const SESSION_ID_KEY = 'edvora.mobile.session.sessionId';

export async function readSession(): Promise<StoredSession | null> {
  const [refreshToken, sessionId] = await Promise.all([
    getSecureItem(REFRESH_TOKEN_KEY),
    getSecureItem(SESSION_ID_KEY),
  ]);

  if (!refreshToken || !sessionId) {
    return null;
  }

  return { refreshToken, sessionId };
}

export async function writeSession(session: StoredSession): Promise<void> {
  await Promise.all([
    setSecureItem(REFRESH_TOKEN_KEY, session.refreshToken),
    setSecureItem(SESSION_ID_KEY, session.sessionId),
  ]);
}

export async function clearSession(): Promise<void> {
  await Promise.all([deleteSecureItem(REFRESH_TOKEN_KEY), deleteSecureItem(SESSION_ID_KEY)]);
}
