import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useAuth } from '@/features/auth/auth-context';
import { useDevice } from '@/features/device/device-context';

// Don't re-validate on every brief backgrounding (e.g. a system share sheet, a
// notification shade pull-down) — only when the app has genuinely been away for a
// while, so a revoked/replaced device or an expired session is caught without
// hammering the backend on normal, rapid app-switching.
const MIN_REVALIDATE_INTERVAL_MS = 60_000;

/**
 * Re-validates the session and device authorization when the app returns to the
 * foreground. Protected state (an authenticated session, an authorized device)
 * must not stay trusted indefinitely across backgrounding — the access token can
 * expire, the refresh session can be revoked, or Platform Admin can revoke/replace
 * this device while the app was backgrounded.
 */
export function useForegroundRevalidation(): void {
  const { status: authStatus, refreshSession } = useAuth();
  const { retry: retryDevice } = useDevice();
  // Initialized to null (not Date.now()) so the timestamp is only ever produced
  // inside the event handler below, never as a side effect of rendering.
  const lastCheckedAt = useRef<number | null>(null);
  const appState = useRef(AppState.currentState);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next: AppStateStatus) => {
      const cameToForeground = appState.current.match(/inactive|background/) && next === 'active';
      appState.current = next;

      if (!cameToForeground) {
        return;
      }

      const now = Date.now();
      if (lastCheckedAt.current !== null && now - lastCheckedAt.current < MIN_REVALIDATE_INTERVAL_MS) {
        return;
      }
      lastCheckedAt.current = now;

      void refreshSession();

      if (authStatus === 'authenticated') {
        retryDevice();
      }
    });

    return () => subscription.remove();
  }, [authStatus, refreshSession, retryDevice]);
}
