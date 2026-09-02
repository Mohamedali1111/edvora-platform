import { apiClient } from '@/features/auth/auth-client';
import { buildDeviceMetadata } from './device-metadata';
import { getOrCreateInstallationId } from './installation-id';
import type { DeviceChangeResponse, DeviceStatusResponse } from './device-types';

// Matches INSTALLATION_ID_HEADER in apps/api/src/modules/devices/types/device.types.ts.
const INSTALLATION_ID_HEADER = 'x-edvora-installation-id';

async function installationHeaders(): Promise<Record<string, string>> {
  const installationId = await getOrCreateInstallationId();
  return { [INSTALLATION_ID_HEADER]: installationId };
}

export async function fetchDeviceStatus(): Promise<DeviceStatusResponse> {
  return apiClient.request<DeviceStatusResponse>('/student/device/status', {
    headers: await installationHeaders(),
  });
}

export async function authorizeCurrentDevice(): Promise<DeviceStatusResponse> {
  return apiClient.request<DeviceStatusResponse>('/student/device/authorize', {
    method: 'POST',
    headers: await installationHeaders(),
    body: buildDeviceMetadata(),
  });
}

export async function requestDeviceChange(reason?: string): Promise<DeviceChangeResponse> {
  return apiClient.request<DeviceChangeResponse>('/student/device/change-request', {
    method: 'POST',
    headers: await installationHeaders(),
    body: { ...buildDeviceMetadata(), reason },
  });
}
