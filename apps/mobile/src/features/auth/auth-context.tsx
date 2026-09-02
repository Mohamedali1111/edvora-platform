import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError } from '@/lib/api/errors';
import * as authClient from './auth-client';
import type { CurrentUserSummary } from './auth-types';

export type AuthStatus =
  | 'bootstrapping'
  | 'anonymous'
  | 'authenticated'
  | 'expired'
  | 'forbidden'
  | 'api-unavailable';

type AuthContextValue = {
  status: AuthStatus;
  user: CurrentUserSummary | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Re-runs the same bootstrap resolution login/foreground-resume use — lets a screen retry after "API unavailable". */
  refreshSession: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('bootstrapping');
  const [user, setUser] = useState<CurrentUserSummary | null>(null);

  const resolveSession = useCallback(async () => {
    // Deliberately does not set status to 'bootstrapping' synchronously here: on
    // first mount it already defaults to 'bootstrapping', and on a later call
    // (post-login, or a foreground revalidation — see lib/app-lifecycle.ts) the
    // previously-resolved screen should keep rendering until this resolves rather
    // than flash back to a loading state.
    const hasSession = await authClient.bootstrapFromStoredSession().catch((error: unknown) => {
      if (error instanceof ApiError && error.kind === 'network') {
        throw error;
      }
      return false;
    });

    if (!hasSession) {
      setUser(null);
      setStatus('anonymous');
      return;
    }

    try {
      const currentUser = await authClient.getCurrentUser();

      if (currentUser.role !== 'STUDENT') {
        await authClient.logout();
        setUser(currentUser);
        setStatus('forbidden');
        return;
      }

      setUser(currentUser);
      setStatus('authenticated');
    } catch (error: unknown) {
      if (error instanceof ApiError && (error.status === 401 || error.code === 'INVALID_REFRESH_SESSION')) {
        setUser(null);
        setStatus('expired');
        return;
      }

      if (error instanceof ApiError && error.status === 403) {
        await authClient.logout();
        setUser(null);
        setStatus('forbidden');
        return;
      }

      throw error;
    }
  }, []);

  const refreshSession = useCallback(async () => {
    try {
      await resolveSession();
    } catch (error: unknown) {
      if (error instanceof ApiError && error.kind === 'network') {
        setStatus('api-unavailable');
        return;
      }

      throw error;
    }
  }, [resolveSession]);

  useEffect(() => {
    // This is the standard "fetch on mount" effect: it kicks off the async session
    // resolution and lets its own eventual `setState` calls happen in later
    // microtasks/re-renders, not synchronously within this effect body. The
    // set-state-in-effect rule's static analysis can't see across the `async`
    // boundary inside refreshSession/resolveSession, so it flags this call itself
    // as if it set state synchronously; it does not.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshSession();
    // Intentionally runs once on mount only — refreshSession is stable (useCallback)
    // and app-lifecycle resume revalidation is wired separately (see app-lifecycle.ts).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      await authClient.login(email, password);
      await resolveSession();
    },
    [resolveSession],
  );

  const logout = useCallback(async () => {
    await authClient.logout();
    setUser(null);
    setStatus('anonymous');
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, login, logout, refreshSession }),
    [status, user, login, logout, refreshSession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);

  if (!value) {
    throw new Error('useAuth must be used inside AuthProvider.');
  }

  return value;
}
