import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import type { VideoPlayer } from 'expo-video';
import { needsRefreshOnForegroundResume } from './playback-expiry';
import { shouldPauseForAppState } from './capture-state';

/**
 * Video-screen-scoped app-lifecycle handling (§7/§8 of the milestone spec) —
 * deliberately separate from the app-wide `useForegroundRevalidation`
 * (lib/app-lifecycle.ts), which already re-validates session/device on
 * foreground and keeps doing so regardless of this hook. This hook only owns
 * what is specific to an open video player: pausing it the instant the app
 * leaves the foreground (so protected video never keeps rendering/audible while
 * backgrounded), and — on return to foreground only, never on a running timer —
 * checking whether the currently-held playback capability is at or near its own
 * expiry, requesting a fresh one if so. The backend re-validates entitlement
 * from scratch on every /video/access call; this hook never decides
 * access itself, only when to ask again.
 */
export function useVideoLifecycle(input: {
  player: VideoPlayer | null;
  expiresAt: string | null;
  onNeedsRefresh: () => void;
}): void {
  const appState = useRef(AppState.currentState);
  const playerRef = useRef(input.player);
  const expiresAtRef = useRef(input.expiresAt);
  const onNeedsRefreshRef = useRef(input.onNeedsRefresh);

  // Keeps the refs at their latest value without ever reading/writing `.current`
  // during render itself (not pure) — this effect's only job is that sync, so it
  // deliberately has no dependency array and runs after every render.
  useEffect(() => {
    playerRef.current = input.player;
    expiresAtRef.current = input.expiresAt;
    onNeedsRefreshRef.current = input.onNeedsRefresh;
  });

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next: AppStateStatus) => {
      const previous = appState.current;
      appState.current = next;

      if (shouldPauseForAppState(next)) {
        playerRef.current?.pause();
        return;
      }

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
