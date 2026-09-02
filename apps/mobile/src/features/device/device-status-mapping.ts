import type { RawDeviceStatus } from './device-types';

// Owned here (not device-context.tsx) so this module stays fully self-contained —
// zero React/RN/Expo imports, and no transitive import edge back into
// device-context.tsx's own import graph (which pulls in auth-client, the API
// client, expo-constants, expo-secure-store, etc.). That matters specifically
// because this file is compiled and executed directly under the plain-Node test
// harness (see device-status-mapping.test.ts / src/test-runner.ts): keeping it
// import-graph-isolated keeps that harness fast and free of native-module
// resolution issues. device-context.tsx imports this type from here.
export type DeviceUiStatus =
  | 'idle'
  | 'checking'
  | 'authorized'
  | 'change_required'
  | 'change_pending'
  | 'requesting_change'
  | 'error';

/**
 * Pure, stateless mapping from the backend's wire status to this app's UI status —
 * no client-side memory, no persistence, no inference about *why* a status is what
 * it is. `StudentDeviceAuthorizationStatus` (apps/api/src/modules/devices/types/device.types.ts)
 * has no REJECTED member: once Platform Admin rejects a change request, a fresh
 * status check for that installation simply reads back CHANGE_REQUIRED again,
 * wire-identical to "this device has never asked before". This mapping honors that
 * — CHANGE_REQUIRED always renders as the same neutral "not approved" state,
 * never as an invented "rejected" label the backend cannot substantiate.
 * NO_DEVICE_REGISTERED folds into the same neutral state as a defensive fallback
 * (evaluate() in device-context.tsx normally never calls this with that value — it
 * auto-authorizes first — but requesting a change from that state is still the
 * correct action).
 *
 * Kept in its own module (no React, no RN, no Expo imports) specifically so it can
 * be unit-tested directly under plain Node — see device-status-mapping.test.ts.
 */
export function toUiStatus(status: RawDeviceStatus | 'AUTHORIZED' | 'CHANGE_PENDING'): DeviceUiStatus {
  if (status === 'AUTHORIZED') {
    return 'authorized';
  }

  if (status === 'CHANGE_PENDING') {
    return 'change_pending';
  }

  return 'change_required';
}
