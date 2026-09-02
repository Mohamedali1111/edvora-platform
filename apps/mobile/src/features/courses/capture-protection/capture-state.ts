// Pure decisions for a protected-content screen's capture-protection and
// lifecycle UI state — no React, no RN, no expo-screen-capture import, so
// these compose correctly under the plain-Node test harness. Shared by the
// Video and Document lesson screens (see use-capture-protection.ts for the
// hook that drives real events into these functions) — genuinely
// content-type-agnostic: nothing here is specific to playback or rendering.

export type CaptureWarningState = { visible: boolean; sinceMs: number | null };

export const CAPTURE_WARNING_DISMISSED: CaptureWarningState = { visible: false, sinceMs: null };

// How long the honest "screenshots/recording aren't allowed" notice stays on
// screen after a real detected screenshot event, before auto-dismissing. Not a
// polling interval — use-capture-protection.ts schedules exactly one `setTimeout`
// for this duration per real screenshot event (never a running/repeating timer),
// and this same exported constant keeps that timeout and the pure
// `shouldDismissCaptureWarning` check below in sync from one source of truth.
export const CAPTURE_WARNING_DISPLAY_DURATION_MS = 4_000;

/** Call when a real `useScreenshotListener` event fires. */
export function triggerCaptureWarning(nowMs: number): CaptureWarningState {
  return { visible: true, sinceMs: nowMs };
}

/** Whether an active warning has been shown long enough to auto-dismiss. */
export function shouldDismissCaptureWarning(state: CaptureWarningState, nowMs: number): boolean {
  return state.visible && state.sinceMs !== null && nowMs - state.sinceMs >= CAPTURE_WARNING_DISPLAY_DURATION_MS;
}

/**
 * Whether protected content should be paused/hidden for this AppState
 * transition. Anything other than 'active' (background, inactive, and any
 * future RN AppState value) pauses — fail safe: an unrecognized state is
 * treated as "not safely foregrounded" rather than assumed to still be
 * visible.
 */
export function shouldPauseForAppState(nextAppState: string): boolean {
  return nextAppState !== 'active';
}
