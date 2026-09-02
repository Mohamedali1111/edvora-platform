import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { needsRefreshOnForegroundResume } from '../capability-expiry';

/**
 * Document-screen-scoped app-lifecycle handling — the Document analog of
 * `video/use-video-lifecycle.ts`, deliberately separate from the app-wide
 * `useForegroundRevalidation` (lib/app-lifecycle.ts), which already
 * re-validates session/device on foreground and keeps doing so regardless of
 * this hook.
 *
 * Simpler than the VIDEO version by design: there is no player to pause on
 * backgrounding — a rendered PDF page is static, not actively
 * streaming/decoding/audible, and exposure while backgrounded is already
 * handled by `useCaptureProtection`'s FLAG_SECURE / app-switcher-blur, which
 * stays active for this screen's whole mounted lifetime regardless of
 * foreground/background state. This hook only owns the one thing that is
 * genuinely lifecycle-shaped: on return to foreground (never on a running
 * timer), checking whether the currently-held download capability is at or
 * near its own expiry, and requesting a fresh one if so. The backend
 * re-validates entitlement from scratch on every /document/access call; this
 * hook never decides access itself, only when to ask again.
 */
export function useDocumentLifecycle(input: { expiresAt: string | null; onNeedsRefresh: () => void }): void {
  const appState = useRef(AppState.currentState);
  const expiresAtRef = useRef(input.expiresAt);
  const onNeedsRefreshRef = useRef(input.onNeedsRefresh);

  // Keeps the refs at their latest value without ever reading/writing
  // `.current` during render itself (not pure) — this effect's only job is
  // that sync, so it deliberately has no dependency array and runs after
  // every render.
  useEffect(() => {
    expiresAtRef.current = input.expiresAt;
    onNeedsRefreshRef.current = input.onNeedsRefresh;
  });

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next: AppStateStatus) => {
      const previous = appState.current;
      appState.current = next;

      const cameToForeground = previous.match(/inactive|background/) && next === 'active';

      if (!cameToForeground) {
        return;
      }

      const expiresAt = expiresAtRef.current;

      if (expiresAt && needsRefreshOnForegroundResume(expiresAt, Date.now())) {
        onNeedsRefreshRef.current();
      }
    });

    return () => subscription.remove();
  }, []);
}
