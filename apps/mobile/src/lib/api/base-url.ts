import Constants from 'expo-constants';

const DEFAULT_PORT = '3001';

/**
 * Resolves the Edvora API base URL for this build.
 *
 * 1. `EXPO_PUBLIC_API_BASE_URL` — Expo inlines any `EXPO_PUBLIC_*` env var into the
 *    JS bundle at build time (see Expo's env var docs). This is how a real
 *    (staging/production) build must be configured; nothing else in this file
 *    applies once it is set.
 * 2. Otherwise, in local development, derive the dev machine's LAN address from the
 *    Metro/Expo dev server host (`expoConfig.hostUri`, e.g. "192.168.1.20:8081") and
 *    point at API port 3001 on that same host. This is what lets a physical device
 *    or Android emulator running Expo Go reach a laptop-hosted API without any
 *    manual configuration — "localhost" from the device's perspective is the device
 *    itself, not the dev machine.
 * 3. Final fallback: localhost, for iOS Simulator / web, where "localhost" does
 *    resolve to the dev machine.
 *
 * No API keys or secrets live here or anywhere in the bundle — only a base URL.
 */
export function resolveApiBaseUrl(): string {
  const configured = process.env.EXPO_PUBLIC_API_BASE_URL;

  if (configured && configured.trim().length > 0) {
    return normalizeBaseUrl(configured);
  }

  const hostUri = Constants.expoConfig?.hostUri ?? Constants.expoGoConfig?.debuggerHost;
  const devHost = hostUri?.split(':')[0];

  if (devHost) {
    return normalizeBaseUrl(`http://${devHost}:${DEFAULT_PORT}`);
  }

  return normalizeBaseUrl(`http://localhost:${DEFAULT_PORT}`);
}

export function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim();
  return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
}
