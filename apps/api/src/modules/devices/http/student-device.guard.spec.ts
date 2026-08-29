import { ExecutionContext } from '@nestjs/common';
import { PlatformRole } from '../../../../.generated/prisma/client';
import { InvalidAccessTokenError } from '../../auth/errors/auth.errors';
import type { AuthenticatedRequest } from '../../auth/http/authenticated-request';
import { DeviceInstallationIdRequiredError } from '../errors/device.errors';
import { StudentDeviceService } from '../services/student-device.service';
import { INSTALLATION_ID_HEADER } from '../types/device.types';
import { StudentDeviceGuard } from './student-device.guard';

describe('StudentDeviceGuard', () => {
  it('requires an authenticated principal', async () => {
    const devices = createDeviceService();
    const guard = new StudentDeviceGuard(devices as unknown as StudentDeviceService);

    await expect(guard.canActivate(contextFor({ headers: {} }))).rejects.toBeInstanceOf(
      InvalidAccessTokenError,
    );
  });

  it('requires an installation ID header', async () => {
    const devices = createDeviceService();
    const guard = new StudentDeviceGuard(devices as unknown as StudentDeviceService);

    await expect(
      guard.canActivate(
        contextFor({
          headers: {},
          auth: {
            userId: 'user-id',
            sessionId: 'session-id',
            platformRole: PlatformRole.STUDENT,
          },
        }),
      ),
    ).rejects.toBeInstanceOf(DeviceInstallationIdRequiredError);
  });

  it('checks the current database-backed device state', async () => {
    const devices = createDeviceService();
    const guard = new StudentDeviceGuard(devices as unknown as StudentDeviceService);

    await expect(
      guard.canActivate(
        contextFor({
          headers: {
            [INSTALLATION_ID_HEADER]: '00000000-0000-7000-8000-000000000001',
          },
          auth: {
            userId: 'user-id',
            sessionId: 'session-id',
            platformRole: PlatformRole.STUDENT,
          },
        }),
      ),
    ).resolves.toBe(true);

    expect(devices.assertAuthorizedStudentDevice).toHaveBeenCalledWith({
      principal: {
        userId: 'user-id',
        sessionId: 'session-id',
        platformRole: PlatformRole.STUDENT,
      },
      installationId: '00000000-0000-7000-8000-000000000001',
    });
  });
});

function createDeviceService(): jest.Mocked<Pick<StudentDeviceService, 'assertAuthorizedStudentDevice' | 'normalizeInstallationId'>> {
  return {
    assertAuthorizedStudentDevice: jest.fn().mockResolvedValue(undefined),
    normalizeInstallationId: jest.fn((value: string | string[] | undefined) => {
      if (!value) {
        throw new DeviceInstallationIdRequiredError();
      }
      return String(value);
    }),
  };
}

function contextFor(request: Partial<AuthenticatedRequest>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as ExecutionContext;
}
