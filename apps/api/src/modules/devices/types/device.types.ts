import type { DevicePlatform } from '../../../../.generated/prisma/client';

export const INSTALLATION_ID_HEADER = 'x-edvora-installation-id';

export type DeviceMetadata = {
  platform: DevicePlatform;
  deviceModel?: string;
  osVersion?: string;
  appVersion?: string;
};

export type StudentDeviceAuthorizationStatus =
  | 'AUTHORIZED'
  | 'NO_DEVICE_REGISTERED'
  | 'CHANGE_REQUIRED'
  | 'CHANGE_PENDING';

export type StudentDeviceAuthorizationResult = {
  status: StudentDeviceAuthorizationStatus;
  deviceId?: string;
  requestId?: string;
  pendingRequest?: boolean;
};

export type DeviceChangeRequestResult = {
  status: 'AUTHORIZED' | 'PENDING';
  deviceId?: string;
  requestId?: string;
};

export type DeviceChangeRequestSummary = {
  id: string;
  studentUserId: string;
  requestedAt: Date;
  requestedPlatform: DevicePlatform | null;
  requestedDeviceModel: string | null;
  requestedOsVersion: string | null;
  requestedAppVersion: string | null;
  currentDeviceId: string | null;
};
