import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AccessTokenGuard } from '../../auth/http/access-token.guard';
import { CurrentAuth } from '../../auth/http/current-auth.decorator';
import type { AuthenticatedPrincipal } from '../../auth/http/authenticated-principal';
import { DeviceListQueryDto } from '../dto/device-list-query.dto';
import { ReviewDeviceChangeDto } from '../dto/review-device-change.dto';
import type { DeviceChangeRequestSummary } from '../types/device.types';
import { StudentDeviceService } from '../services/student-device.service';

type DeviceChangeRequestListResponse = {
  items: DeviceChangeRequestSummary[];
  limit: number;
  offset: number;
};

const DEVICE_THROTTLE = {
  device: {
    limit: 20,
    ttl: 60_000,
  },
} as const;

@Controller('admin/device-change-requests')
@UseGuards(ThrottlerGuard, AccessTokenGuard)
@Throttle(DEVICE_THROTTLE)
export class AdminDeviceController {
  constructor(private readonly devices: StudentDeviceService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  async listPending(
    @CurrentAuth() principal: AuthenticatedPrincipal,
    @Query() query: DeviceListQueryDto,
  ): Promise<DeviceChangeRequestListResponse> {
    const limit = query.limit ?? 25;
    const offset = query.offset ?? 0;
    const items = await this.devices.listPendingDeviceChangeRequests({
      adminPrincipal: principal,
      limit,
      offset,
    });

    return { items, limit, offset };
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.NO_CONTENT)
  async approve(
    @CurrentAuth() principal: AuthenticatedPrincipal,
    @Param('id') requestId: string,
    @Body() body: ReviewDeviceChangeDto,
  ): Promise<void> {
    await this.devices.approveDeviceChange({
      adminPrincipal: principal,
      requestId,
      reviewNote: body.reviewNote,
    });
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.NO_CONTENT)
  async reject(
    @CurrentAuth() principal: AuthenticatedPrincipal,
    @Param('id') requestId: string,
    @Body() body: ReviewDeviceChangeDto,
  ): Promise<void> {
    await this.devices.rejectDeviceChange({
      adminPrincipal: principal,
      requestId,
      reviewNote: body.reviewNote,
    });
  }
}
