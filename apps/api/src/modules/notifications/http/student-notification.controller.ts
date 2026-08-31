import { Controller, Get, HttpCode, HttpStatus, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AccessTokenGuard } from '../../auth/http/access-token.guard';
import type { AuthenticatedPrincipal } from '../../auth/http/authenticated-principal';
import { CurrentAuth } from '../../auth/http/current-auth.decorator';
import { StudentDeviceGuard } from '../../devices/http/student-device.guard';
import type { OffsetPage } from '../../../infrastructure/http/pagination';
import { PaginationQueryDto } from '../../tenancy/dto/pagination-query.dto';
import { NotificationService } from '../services/notification.service';
import type { NotificationSummary } from '../types/notification.types';
import { NotificationIdParamDto } from './notification-params.dto';

type NotificationListResponse = OffsetPage<NotificationSummary>;

const NOTIFICATION_THROTTLE = {
  notifications: {
    limit: 60,
    ttl: 60_000,
  },
} as const;

@Controller('student/notifications')
@UseGuards(ThrottlerGuard, AccessTokenGuard, StudentDeviceGuard)
@Throttle(NOTIFICATION_THROTTLE)
export class StudentNotificationController {
  constructor(private readonly notifications: NotificationService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  async list(
    @CurrentAuth() principal: AuthenticatedPrincipal,
    @Query() query: PaginationQueryDto,
  ): Promise<NotificationListResponse> {
    const limit = query.limit ?? 25;
    const offset = query.offset ?? 0;
    const { items, hasMore } = await this.notifications.listStudentNotifications(principal, limit, offset);
    return { items, limit, offset, hasMore };
  }

  @Get('unread-count')
  @HttpCode(HttpStatus.OK)
  async unreadCount(@CurrentAuth() principal: AuthenticatedPrincipal): Promise<{ unreadCount: number }> {
    return this.notifications.countUnreadStudentNotifications(principal);
  }

  @Patch('read-all')
  @HttpCode(HttpStatus.OK)
  async readAll(@CurrentAuth() principal: AuthenticatedPrincipal): Promise<{ updatedCount: number }> {
    return this.notifications.markAllStudentNotificationsRead(principal);
  }

  @Patch(':notificationId/read')
  @HttpCode(HttpStatus.OK)
  async read(
    @CurrentAuth() principal: AuthenticatedPrincipal,
    @Param() params: NotificationIdParamDto,
  ): Promise<NotificationSummary> {
    return this.notifications.markStudentNotificationRead(principal, params.notificationId);
  }
}
