import { HttpStatus } from '@nestjs/common';
import {
  DeviceChangeAlreadyPendingError,
  DeviceInstallationIdInvalidError,
  DeviceNotAuthorizedError,
  PlatformAdminRequiredError,
} from '../errors/device.errors';
import { mapDeviceErrorToHttp } from './device-error-mapping';

describe('mapDeviceErrorToHttp', () => {
  it('maps device errors to stable sanitized response bodies', () => {
    expect(mapDeviceErrorToHttp(new DeviceInstallationIdInvalidError())).toEqual({
      status: HttpStatus.BAD_REQUEST,
      body: {
        error: {
          code: 'DEVICE_INSTALLATION_ID_INVALID',
          message: 'Device installation ID is invalid.',
        },
      },
    });

    expect(mapDeviceErrorToHttp(new DeviceNotAuthorizedError()).status).toBe(HttpStatus.FORBIDDEN);
    expect(mapDeviceErrorToHttp(new PlatformAdminRequiredError()).status).toBe(HttpStatus.FORBIDDEN);
    expect(mapDeviceErrorToHttp(new DeviceChangeAlreadyPendingError()).status).toBe(
      HttpStatus.CONFLICT,
    );
  });
});
