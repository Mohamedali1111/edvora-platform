import { Redirect, Stack } from 'expo-router';
import { useDevice } from '@/features/device/device-context';

/**
 * The one shared device-authorization gate for every real learning-content route
 * (home, My Courses, Course Detail, Lesson) — moved here from being duplicated
 * per-screen (the original home.tsx had this exact check inline) so a new screen
 * under this group gets the gate automatically rather than needing to remember to
 * add it. `device-check.tsx` itself stays a sibling of this group, one level up
 * under `(protected)/`, deliberately NOT wrapped by this gate — it is the screen
 * that resolves a not-yet-authorized device, so gating it on "device authorized"
 * would be a contradiction.
 *
 * Reads the same DeviceProvider state device-check.tsx derives from real
 * `/student/device/*` responses; every request a screen below this layout makes
 * still carries its own StudentDeviceGuard check server-side regardless of what
 * this client believes (see content-access-recovery.ts for what happens when the
 * backend and this client's belief disagree while already here).
 */
export default function LearningLayout() {
  const { status } = useDevice();

  if (status !== 'authorized') {
    return <Redirect href="/device-check" />;
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}
