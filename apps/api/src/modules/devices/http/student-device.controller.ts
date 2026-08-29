import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AccessTokenGuard } from '../../auth/http/access-token.guard';
import { CurrentAuth } from '../../auth/http/current-auth.decorator';
import type { AuthenticatedPrincipal } from '../../auth/http/authenticated-principal';
import { DeviceMetadataDto } from '../dto/device-metadata.dto';
import { RequestDeviceChangeDto } from '../dto/request-device-change.dto';
import { INSTALLATION_ID_HEADER, type DeviceChangeRequestResult, type StudentDeviceAuthorizationResult } from '../types/device.types';
import { StudentDeviceService } from '../services/student-device.service';

type DeviceStatusResponse =
  | { status: 'AUTHORIZED' }
  | { status: 'NO_DEVICE_REGISTERED'; pendingRequest: false }
  | { status: 'CHANGE_REQUIRED'; pendingRequest: false }
  | { status: 'CHANGE_PENDING'; pendingRequest: true; requestId: string };

type DeviceChangeResponse =
  | { status: 'AUTHORIZED' }
  | { status: 'CHANGE_PENDING'; requestId: string };

const DEVICE_THROTTLE = {
  device: {
    limit: 20,
    ttl: 60_000,
  },
} as const;

@Controller('student/device')
@UseGuards(ThrottlerGuard, AccessTokenGuard)
@Throttle(DEVICE_THROTTLE)
export class StudentDeviceController {
  constructor(private readonly devices: StudentDeviceService) {}

  @Post('authorize')
  @HttpCode(HttpStatus.OK)
  async authorize(
    @CurrentAuth() principal: AuthenticatedPrincipal,
    @Headers(INSTALLATION_ID_HEADER) installationId: string | string[] | undefined,
    @Body() body: DeviceMetadataDto,
  ): Promise<DeviceStatusResponse> {
    const result = await this.devices.authorizeInitialStudentDevice({
      principal,
      installationId: this.devices.normalizeInstallationId(installationId),
      metadata: body,
    });

    return toDeviceStatusResponse(result);
  }

  @Post('change-request')
  @HttpCode(HttpStatus.OK)
  async requestChange(
    @CurrentAuth() principal: AuthenticatedPrincipal,
    @Headers(INSTALLATION_ID_HEADER) installationId: string | string[] | undefined,
    @Body() body: RequestDeviceChangeDto,
  ): Promise<DeviceChangeResponse> {
    const result = await this.devices.requestDeviceChange({
      principal,
      installationId: this.devices.normalizeInstallationId(installationId),
      metadata: body,
      reason: body.reason,
    });

    return toDeviceChangeResponse(result);
  }

  @Get('status')
  @HttpCode(HttpStatus.OK)
  async status(
    @CurrentAuth() principal: AuthenticatedPrincipal,
    @Headers(INSTALLATION_ID_HEADER) installationId: string | string[] | undefined,
  ): Promise<DeviceStatusResponse> {
    const result = await this.devices.checkStudentDeviceAuthorization({
      principal,
      installationId: this.devices.normalizeInstallationId(installationId),
    });

    return toDeviceStatusResponse(result);
  }
}

function toDeviceStatusResponse(result: StudentDeviceAuthorizationResult): DeviceStatusResponse {
  if (result.status === 'AUTHORIZED') {
    return { status: 'AUTHORIZED' };
  }

  if (result.status === 'CHANGE_PENDING' && result.requestId) {
    return { status: 'CHANGE_PENDING', pendingRequest: true, requestId: result.requestId };
  }

  if (result.status === 'CHANGE_REQUIRED') {
    return { status: 'CHANGE_REQUIRED', pendingRequest: false };
  }

  return { status: 'NO_DEVICE_REGISTERED', pendingRequest: false };
}

function toDeviceChangeResponse(result: DeviceChangeRequestResult): DeviceChangeResponse {
  if (result.status === 'AUTHORIZED') {
    return { status: 'AUTHORIZED' };
  }

  return { status: 'CHANGE_PENDING', requestId: result.requestId ?? '' };
}
