import * as Crypto from 'expo-crypto';
import { getSecureItem, setSecureItem } from '@/lib/storage/secure-store';

/**
 * The ONLY device identity Student Mobile sends the backend: a random UUID this
 * app generates once and persists for its own lifetime, sent as the
 * `x-edvora-installation-id` header (`INSTALLATION_ID_HEADER`,
 * apps/api/src/modules/devices/types/device.types.ts). The backend only ever sees
 * a SHA-256 hash of it (`StudentDeviceService.hashInstallationId`) and nothing
 * else about the device.
 *
 * Deliberately NOT a hardware serial, IMEI, MAC address, or advertising ID — none
 * of those are collected anywhere in this app. Reinstalling the app produces a new
 * id (SecureStore is cleared with the app on both platforms), which correctly
 * looks like a new device to the backend and goes through device authorization
 * again — this is intentional, not a bug: it's the same "device" concept the
 * backend already models (`StudentDevice.clientDeviceIdHash`).
 */
const INSTALLATION_ID_KEY = 'edvora.mobile.installationId';

let cachedInstallationId: string | null = null;

export async function getOrCreateInstallationId(): Promise<string> {
  if (cachedInstallationId) {
    return cachedInstallationId;
  }

  const existing = await getSecureItem(INSTALLATION_ID_KEY);

  if (existing) {
    cachedInstallationId = existing;
    return existing;
  }

  const created = Crypto.randomUUID();
  await setSecureItem(INSTALLATION_ID_KEY, created);
  cachedInstallationId = created;
  return created;
}
