import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { InvalidAccessTokenError } from '../../auth/errors/auth.errors';
import type { AuthenticatedRequest } from '../../auth/http/authenticated-request';
import { INSTALLATION_ID_HEADER } from '../types/device.types';
import { StudentDeviceService } from '../services/student-device.service';

@Injectable()
export class StudentDeviceGuard implements CanActivate {
  constructor(private readonly devices: StudentDeviceService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    if (!request.auth) {
      throw new InvalidAccessTokenError();
    }

    await this.devices.assertAuthorizedStudentDevice({
      principal: request.auth,
      installationId: this.devices.normalizeInstallationId(request.headers[INSTALLATION_ID_HEADER]),
    });

    return true;
  }
}
