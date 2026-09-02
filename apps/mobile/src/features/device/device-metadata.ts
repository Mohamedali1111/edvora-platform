import Constants from 'expo-constants';
import * as ExpoDevice from 'expo-device';
import { Platform } from 'react-native';
import type { DeviceMetadata, DevicePlatform } from './device-types';

/**
 * Populates only the fields `DeviceMetadataDto` already defines
 * (apps/api/src/modules/devices/dto/device-metadata.dto.ts): platform, a
 * human-readable model name, OS version, and this app's own version. This is the
 * same class of information the Platform Admin device-review UI already displays
 * (`apps/web/src/features/admin/device-requests/*`) — nothing more invasive.
 * `expo-device`'s `modelName` (e.g. "Pixel 8") is not a persistent hardware
 * identifier: it does not identify one physical unit, only a model.
 */
export function buildDeviceMetadata(): DeviceMetadata {
  return {
    platform: toDevicePlatform(),
    deviceModel: ExpoDevice.modelName ?? undefined,
    osVersion: ExpoDevice.osVersion ?? String(Platform.Version ?? ''),
    appVersion: Constants.expoConfig?.version,
  };
}

function toDevicePlatform(): DevicePlatform {
  return Platform.OS === 'ios' ? 'IOS' : 'ANDROID';
}
