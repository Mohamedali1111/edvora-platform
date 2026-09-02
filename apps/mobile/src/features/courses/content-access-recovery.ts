/**
 * When a Course/Section/Lesson content fetch fails, this decides which of the
 * *existing* auth/device state machines (AuthProvider, DeviceProvider — see
 * features/auth/auth-context.tsx, features/device/device-context.tsx) needs to
 * re-resolve, so the app routes back through them rather than leaving stale
 * protected content on-screen. This is deliberately not a new state machine: it
 * only decides which existing one to nudge back into re-checking itself.
 *
 * 'auth': the session itself is no longer valid (expired/invalid access+refresh
 * token, account no longer available/eligible) — re-run session resolution, which
 * will land on 'expired'/'forbidden'/'anonymous' as appropriate and the existing
 * protected-route redirects take over from there.
 *
 * 'device': the session is fine but this specific device no longer is
 * (StudentDeviceGuard's DEVICE_NOT_AUTHORIZED — the device was revoked/replaced
 * while this screen was open — or a malformed/missing installation header) —
 * re-run device status resolution, which will land on 'change_required' etc. and
 * the (learning) layout's device gate redirects to /device-check.
 *
 * 'none': a genuine content-scoped rejection (COURSE_NOT_FOUND, LESSON_NOT_FOUND,
 * a network error, ...) that says nothing about session/device validity — the
 * screen should just show its own honest error state, not touch either machine.
 */
export type ContentAccessRecoveryAction = 'auth' | 'device' | 'none';

const AUTH_RECOVERY_CODES = new Set([
  'INVALID_ACCESS_TOKEN',
  'EXPIRED_ACCESS_TOKEN',
  'INVALID_REFRESH_SESSION',
  'ACCOUNT_UNAVAILABLE',
  'STUDENT_REQUIRED',
]);

const DEVICE_RECOVERY_CODES = new Set([
  'DEVICE_NOT_AUTHORIZED',
  'DEVICE_INSTALLATION_ID_REQUIRED',
  'DEVICE_INSTALLATION_ID_INVALID',
  'ACCOUNT_INACTIVE',
]);

export function classifyContentAccessError(errorCode: string): ContentAccessRecoveryAction {
  if (AUTH_RECOVERY_CODES.has(errorCode)) {
    return 'auth';
  }

  if (DEVICE_RECOVERY_CODES.has(errorCode)) {
    return 'device';
  }

  return 'none';
}
