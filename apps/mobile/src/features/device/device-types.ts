// Mirrors apps/api/src/modules/devices/http/student-device.controller.ts's response
// shapes and apps/api/src/modules/devices/dto/device-metadata.dto.ts exactly.

export type DevicePlatform = 'IOS' | 'ANDROID';

export type DeviceMetadata = {
  platform: DevicePlatform;
  deviceModel?: string;
  osVersion?: string;
  appVersion?: string;
};

export type DeviceStatusResponse =
  | { status: 'AUTHORIZED' }
  | { status: 'NO_DEVICE_REGISTERED'; pendingRequest: false }
  | { status: 'CHANGE_REQUIRED'; pendingRequest: false }
  | { status: 'CHANGE_PENDING'; pendingRequest: true; requestId: string };

export type DeviceChangeResponse =
  | { status: 'AUTHORIZED' }
  | { status: 'CHANGE_PENDING'; requestId: string };

export type RawDeviceStatus = DeviceStatusResponse['status'];
