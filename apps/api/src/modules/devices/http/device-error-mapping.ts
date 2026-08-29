import { HttpStatus } from '@nestjs/common';
import type { DeviceError } from '../errors/device.errors';

type ErrorResponseBody = {
  error: {
    code: string;
    message: string;
  };
};

const DEVICE_HTTP_STATUS: Record<DeviceError['code'], number> = {
  ACCOUNT_INACTIVE: HttpStatus.FORBIDDEN,
  DEVICE_CHANGE_ALREADY_PENDING: HttpStatus.CONFLICT,
  DEVICE_CHANGE_REQUIRED: HttpStatus.CONFLICT,
  DEVICE_CHANGE_REQUEST_ALREADY_RESOLVED: HttpStatus.CONFLICT,
  DEVICE_CHANGE_REQUEST_NOT_FOUND: HttpStatus.NOT_FOUND,
  DEVICE_INSTALLATION_ID_INVALID: HttpStatus.BAD_REQUEST,
  DEVICE_INSTALLATION_ID_REQUIRED: HttpStatus.BAD_REQUEST,
  DEVICE_NOT_AUTHORIZED: HttpStatus.FORBIDDEN,
  PLATFORM_ADMIN_REQUIRED: HttpStatus.FORBIDDEN,
  STUDENT_REQUIRED: HttpStatus.FORBIDDEN,
};

const DEVICE_PUBLIC_MESSAGES: Record<DeviceError['code'], string> = {
  ACCOUNT_INACTIVE: 'Account is not active.',
  DEVICE_CHANGE_ALREADY_PENDING: 'Device change request is already pending.',
  DEVICE_CHANGE_REQUIRED: 'Device change is required.',
  DEVICE_CHANGE_REQUEST_ALREADY_RESOLVED: 'Device change request is already resolved.',
  DEVICE_CHANGE_REQUEST_NOT_FOUND: 'Device change request was not found.',
  DEVICE_INSTALLATION_ID_INVALID: 'Device installation ID is invalid.',
  DEVICE_INSTALLATION_ID_REQUIRED: 'Device installation ID is required.',
  DEVICE_NOT_AUTHORIZED: 'Device is not authorized.',
  PLATFORM_ADMIN_REQUIRED: 'Platform Admin account is required.',
  STUDENT_REQUIRED: 'Student account is required.',
};

export function mapDeviceErrorToHttp(error: DeviceError): {
  status: number;
  body: ErrorResponseBody;
} {
  return {
    status: DEVICE_HTTP_STATUS[error.code],
    body: {
      error: {
        code: error.code,
        message: DEVICE_PUBLIC_MESSAGES[error.code],
      },
    },
  };
}
