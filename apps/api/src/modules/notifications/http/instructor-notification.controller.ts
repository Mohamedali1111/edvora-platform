import { Controller, Get, HttpCode, HttpStatus, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AccessTokenGuard } from '../../auth/http/access-token.guard';
import type { AuthenticatedPrincipal } from '../../auth/http/authenticated-principal';
import { CurrentAuth } from '../../auth/http/current-auth.decorator';
import { PaginationQueryDto } from '../../tenancy/dto/pagination-query.dto';
import { NotificationService } from '../services/notification.service';
import type { NotificationSummary } from '../types/notification.types';
import { NotificationIdParamDto } from './notification-params.dto';

type NotificationListResponse = {
  items: NotificationSummary[];
  limit: number;
  offset: number;
};

const NOTIFICATION_THROTTLE = {
  notifications: {
    limit: 60,
    ttl: 60_000,
  },
} as const;

@Controller('instructor/notifications')
@UseGuards(ThrottlerGuard, AccessTokenGuard)
@Throttle(NOTIFICATION_THROTTLE)
export class InstructorNotificationController {
  constructor(private readonly notifications: NotificationService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  async list(
    @CurrentAuth() principal: AuthenticatedPrincipal,
    @Query() query: PaginationQueryDto,
  ): Promise<NotificationListResponse> {
    const limit = query.limit ?? 25;
    const offset = query.offset ?? 0;
    return {
      items: await this.notifications.listInstructorNotifications(principal, limit, offset),
      limit,
      offset,
    };
  }

  @Get('unread-count')
  @HttpCode(HttpStatus.OK)
  async unreadCount(@CurrentAuth() principal: AuthenticatedPrincipal): Promise<{ unreadCount: number }> {
    return this.notifications.countUnreadInstructorNotifications(principal);
  }

  @Patch(':notificationId/read')
  @HttpCode(HttpStatus.OK)
  async read(
    @CurrentAuth() principal: AuthenticatedPrincipal,
    @Param() params: NotificationIdParamDto,
  ): Promise<NotificationSummary> {
    return this.notifications.markInstructorNotificationRead(principal, params.notificationId);
  }
}
