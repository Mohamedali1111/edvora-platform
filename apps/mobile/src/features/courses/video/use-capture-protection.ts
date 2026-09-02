import * as ScreenCapture from 'expo-screen-capture';
import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { CAPTURE_WARNING_DISPLAY_DURATION_MS, CAPTURE_WARNING_DISMISSED, triggerCaptureWarning } from './capture-state';

// A stable, screen-scoped key: `preventScreenCaptureAsync`/`allowScreenCaptureAsync`
// take an optional key specifically so multiple screens/hooks using this API don't
// clobber each other's on/off state (see the package's own docs) — every call this
// hook makes uses this one key, so it only ever affects protection it itself
// turned on.
const CAPTURE_PROTECTION_KEY = 'edvora.video-lesson';

export type CaptureProtection = {
  /** True while a real screenshot event was recently detected (see capture-state.ts for the auto-dismiss window). */
  warningVisible: boolean;
};

/**
 * Scopes Bunny-protected-video screen-capture mitigation to exactly the
 * lifetime this hook is mounted (the Video Lesson screen) — activated on mount,
 * released on unmount, never left globally active. See the milestone report's
 * "Android Capture Protection" / "iOS Capture / Recording Mitigation" sections
 * for exactly what this does and does not guarantee per platform; in short:
 *
 * - `preventScreenCaptureAsync` — Android: real OS-level FLAG_SECURE (screenshots
 *   and recordings produce a blank/black capture; the recent-apps switcher
 *   preview is blanked automatically). iOS: blocks screenshots via the
 *   documented secure-textfield technique, and separately (entirely inside the
 *   native module, with no JS-level callback this hook can observe or react to)
 *   auto-blackens the whole app while `UIScreen.main.isCaptured` is true, i.e.
 *   while the screen is actively being recorded/mirrored. Real, but NOT
 *   something this app can hook a custom pause/message into — see
 *   `video-lesson-screen.tsx`'s capture-notice copy for how this is
 *   communicated honestly rather than overclaimed.
 * - `enableAppSwitcherProtectionAsync`/`disableAppSwitcherProtectionAsync`
 *   (iOS only) — blurs the app-switcher/background snapshot so a backgrounded
 *   frame of protected video isn't visible there; Android already gets the
 *   equivalent for free from `preventScreenCaptureAsync` itself (per the
 *   package's own docs).
 * - `useScreenshotListener` — the one real, reactive, cross-platform signal this
 *   package exposes: fires once per actual screenshot taken while foregrounded.
 *   Used here to show a brief, honest in-app notice (`warningVisible`) and to
 *   call the caller's `onCaptureDetected` (video-lesson-screen.tsx pauses
 *   playback there — the one real "detect and respond" moment this package
 *   version supports; never claimed as ongoing-recording detection, which it
 *   does not expose to JS).
 */
export function useCaptureProtection(input: { onCaptureDetected?: () => void } = {}): CaptureProtection {
  const [warning, setWarning] = useState(CAPTURE_WARNING_DISMISSED);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Ref so the screenshot-listener effect below never needs to re-subscribe
  // just because the caller passed a new inline callback identity. Synced in
  // its own dependency-less effect, never during render itself (not pure).
  const onCaptureDetectedRef = useRef(input.onCaptureDetected);
  useEffect(() => {
    onCaptureDetectedRef.current = input.onCaptureDetected;
  });

  useEffect(() => {
    void ScreenCapture.preventScreenCaptureAsync(CAPTURE_PROTECTION_KEY);

    if (Platform.OS === 'ios') {
      void ScreenCapture.enableAppSwitcherProtectionAsync();
    }

    return () => {
      void ScreenCapture.allowScreenCaptureAsync(CAPTURE_PROTECTION_KEY);

      if (Platform.OS === 'ios') {
        void ScreenCapture.disableAppSwitcherProtectionAsync();
      }

      if (dismissTimer.current) {
        clearTimeout(dismissTimer.current);
      }
    };
  }, []);

  useEffect(() => {
    const subscription = ScreenCapture.addScreenshotListener(() => {
      if (dismissTimer.current) {
        clearTimeout(dismissTimer.current);
      }

      setWarning(triggerCaptureWarning(Date.now()));
      onCaptureDetectedRef.current?.();
      dismissTimer.current = setTimeout(() => {
        setWarning(CAPTURE_WARNING_DISMISSED);
      }, CAPTURE_WARNING_DISPLAY_DURATION_MS);
    });

    return () => subscription.remove();
  }, []);

  return { warningVisible: warning.visible };
}
