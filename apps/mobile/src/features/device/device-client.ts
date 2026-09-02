import { apiClient } from '@/features/auth/auth-client';
import { buildDeviceMetadata } from './device-metadata';
import { buildInstallationHeaders } from './installation-id';
import type { DeviceChangeResponse, DeviceStatusResponse } from './device-types';

export async function fetchDeviceStatus(): Promise<DeviceStatusResponse> {
  return apiClient.request<DeviceStatusResponse>('/student/device/status', {
    headers: await buildInstallationHeaders(),
  });
}

export async function authorizeCurrentDevice(): Promise<DeviceStatusResponse> {
  return apiClient.request<DeviceStatusResponse>('/student/device/authorize', {
    method: 'POST',
    headers: await buildInstallationHeaders(),
    body: buildDeviceMetadata(),
  });
}

export async function requestDeviceChange(reason?: string): Promise<DeviceChangeResponse> {
  return apiClient.request<DeviceChangeResponse>('/student/device/change-request', {
    method: 'POST',
    headers: await buildInstallationHeaders(),
    body: { ...buildDeviceMetadata(), reason },
  });
}
