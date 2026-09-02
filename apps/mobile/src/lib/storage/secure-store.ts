import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * Thin wrapper around Expo SecureStore (iOS Keychain / Android Keystore-backed
 * EncryptedSharedPreferences). This is the ONLY place refresh sessions and the
 * device installation id may be persisted — never AsyncStorage, never a plain file.
 *
 * SecureStore has no web implementation (Expo Router also builds for `web` as a
 * dev convenience, but web is not a shipped Student Mobile target — DevicePlatform
 * only models IOS/ANDROID). On web this wrapper no-ops: nothing is persisted, so a
 * reload always starts signed out rather than silently degrading to insecure
 * storage. This module must not gain a localStorage/AsyncStorage fallback.
 */
const isSecureStoreSupported = Platform.OS !== 'web';

export async function getSecureItem(key: string): Promise<string | null> {
  if (!isSecureStoreSupported) {
    return null;
  }

  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

export async function setSecureItem(key: string, value: string): Promise<void> {
  if (!isSecureStoreSupported) {
    return;
  }

  try {
    await SecureStore.setItemAsync(key, value);
  } catch {
    // Best-effort: a write failure (e.g. Keystore unavailable) must not crash the
    // app. The caller keeps working from in-memory state for the current launch;
    // the next cold start simply finds no stored session and starts signed out.
  }
}

export async function deleteSecureItem(key: string): Promise<void> {
  if (!isSecureStoreSupported) {
    return;
  }

  try {
    await SecureStore.deleteItemAsync(key);
  } catch {
    // Best-effort deletion — nothing meaningful to recover from here.
  }
}
