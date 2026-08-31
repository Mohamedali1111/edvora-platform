import { Injectable } from '@nestjs/common';
import {
  AccountStatus,
  NotificationCategory,
  PlatformRole,
  TenantMembershipStatus,
  TenantStatus,
  TenantStudentStatus,
  type Notification,
} from '../../../../.generated/prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { trimToOffsetPage } from '../../../infrastructure/http/pagination';
import type { AuthenticatedPrincipal } from '../../auth/http/authenticated-principal';
import { ClockService } from '../../auth/services/clock.service';
import { UuidV7Service } from '../../auth/services/uuid-v7.service';
import type { PrismaTransactionClient } from '../../auth/types/prisma-transaction.type';
import {
  InstructorRequiredError,
  NotificationNotFoundError,
  StudentRequiredError,
} from '../errors/notification.errors';
import type { NotificationSummary } from '../types/notification.types';

const COURSE_ENROLLMENT_CREATED_TYPE = 'COURSE_ENROLLMENT_CREATED';
const ENROLLMENT_DOMAIN_ENTITY_TYPE = 'Enrollment';

export type EnrollmentNotificationInput = {
  tenantId: string;
  courseId: string;
  courseTitle: string;
  enrollmentId: string;
  studentUserId: string;
  now: Date;
};

@Injectable()
export class NotificationService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly clock: ClockService,
    private readonly uuid: UuidV7Service,
  ) {}

  async listStudentNotifications(
    principal: AuthenticatedPrincipal,
    limit: number,
    offset: number,
  ): Promise<{ items: NotificationSummary[]; hasMore: boolean }> {
    await this.assertActiveRole(principal, PlatformRole.STUDENT);
    return this.listForRecipient(principal.userId, limit, offset);
  }

  async countUnreadStudentNotifications(principal: AuthenticatedPrincipal): Promise<{ unreadCount: number }> {
    await this.assertActiveRole(principal, PlatformRole.STUDENT);
    return this.countUnreadForRecipient(principal.userId);
  }

  async markStudentNotificationRead(
    principal: AuthenticatedPrincipal,
    notificationId: string,
  ): Promise<NotificationSummary> {
    await this.assertActiveRole(principal, PlatformRole.STUDENT);
    return this.markOwnedNotificationRead(principal.userId, notificationId);
  }

  async markAllStudentNotificationsRead(principal: AuthenticatedPrincipal): Promise<{ updatedCount: number }> {
    await this.assertActiveRole(principal, PlatformRole.STUDENT);
    return this.markAllOwnedNotificationsRead(principal.userId);
  }

  async listInstructorNotifications(
    principal: AuthenticatedPrincipal,
    limit: number,
    offset: number,
  ): Promise<{ items: NotificationSummary[]; hasMore: boolean }> {
    await this.assertActiveRole(principal, PlatformRole.INSTRUCTOR);
    return this.listForRecipient(principal.userId, limit, offset);
  }

  async countUnreadInstructorNotifications(principal: AuthenticatedPrincipal): Promise<{ unreadCount: number }> {
    await this.assertActiveRole(principal, PlatformRole.INSTRUCTOR);
    return this.countUnreadForRecipient(principal.userId);
  }

  async markInstructorNotificationRead(
    principal: AuthenticatedPrincipal,
    notificationId: string,
  ): Promise<NotificationSummary> {
    await this.assertActiveRole(principal, PlatformRole.INSTRUCTOR);
    return this.markOwnedNotificationRead(principal.userId, notificationId);
  }

  async createEnrollmentCreatedNotification(
    tx: PrismaTransactionClient,
    input: EnrollmentNotificationInput,
  ): Promise<NotificationSummary> {
    await this.lockDomainNotification(tx, COURSE_ENROLLMENT_CREATED_TYPE, input.enrollmentId);
    await this.assertTenantScopedRecipient(tx, {
      tenantId: input.tenantId,
      recipientUserId: input.studentUserId,
    });

    const existing = await tx.notification.findFirst({
      where: {
        recipientUserId: input.studentUserId,
        type: COURSE_ENROLLMENT_CREATED_TYPE,
        domainEntityType: ENROLLMENT_DOMAIN_ENTITY_TYPE,
        domainEntityId: input.enrollmentId,
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    if (existing) {
      return toNotificationSummary(existing);
    }

    const notification = await tx.notification.create({
      data: {
        id: this.uuid.create(),
        tenantId: input.tenantId,
        recipientUserId: input.studentUserId,
        type: COURSE_ENROLLMENT_CREATED_TYPE,
        category: NotificationCategory.COURSE,
        title: 'New course enrollment',
        body: `You have been enrolled in ${input.courseTitle}.`,
        domainEntityType: ENROLLMENT_DOMAIN_ENTITY_TYPE,
        domainEntityId: input.enrollmentId,
        createdAt: input.now,
      },
    });

    return toNotificationSummary(notification);
  }

  private async listForRecipient(
    recipientUserId: string,
    limit: number,
    offset: number,
  ): Promise<{ items: NotificationSummary[]; hasMore: boolean }> {
    const rows = await this.prismaService.client.notification.findMany({
      where: { recipientUserId },
      take: limit + 1,
      skip: offset,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    const { items, hasMore } = trimToOffsetPage(rows, limit);

    return { items: items.map(toNotificationSummary), hasMore };
  }

  private async countUnreadForRecipient(recipientUserId: string): Promise<{ unreadCount: number }> {
    const unreadCount = await this.prismaService.client.notification.count({
      where: { recipientUserId, readAt: null },
    });

    return { unreadCount };
  }

  private async markOwnedNotificationRead(
    recipientUserId: string,
    notificationId: string,
  ): Promise<NotificationSummary> {
    return this.prismaService.client.$transaction(async (tx) => {
      await tx.notification.updateMany({
        where: { id: notificationId, recipientUserId, readAt: null },
        data: { readAt: this.clock.now() },
      });

      const notification = await tx.notification.findFirst({
        where: { id: notificationId, recipientUserId },
      });

      if (!notification) {
        throw new NotificationNotFoundError();
      }

      return toNotificationSummary(notification);
    });
  }

  private async markAllOwnedNotificationsRead(recipientUserId: string): Promise<{ updatedCount: number }> {
    const result = await this.prismaService.client.notification.updateMany({
      where: { recipientUserId, readAt: null },
      data: { readAt: this.clock.now() },
    });

    return { updatedCount: result.count };
  }

  private async assertActiveRole(
    principal: AuthenticatedPrincipal,
    requiredRole: typeof PlatformRole.STUDENT | typeof PlatformRole.INSTRUCTOR,
  ): Promise<void> {
    const user = await this.prismaService.client.user.findUnique({
      where: { id: principal.userId },
      select: { accountStatus: true, platformRole: true },
    });

    if (!user || user.accountStatus !== AccountStatus.ACTIVE || user.platformRole !== requiredRole) {
      if (requiredRole === PlatformRole.STUDENT) {
        throw new StudentRequiredError();
      }
      throw new InstructorRequiredError();
    }
  }

  private async assertTenantScopedRecipient(
    tx: PrismaTransactionClient,
    input: {
      tenantId: string;
      recipientUserId: string;
    },
  ): Promise<void> {
    const user = await tx.user.findUnique({
      where: { id: input.recipientUserId },
      select: { accountStatus: true, platformRole: true },
    });

    if (!user || user.accountStatus !== AccountStatus.ACTIVE) {
      throw new StudentRequiredError();
    }

    if (user.platformRole === PlatformRole.STUDENT) {
      const association = await tx.tenantStudent.findUnique({
        where: {
          tenantId_studentUserId: {
            tenantId: input.tenantId,
            studentUserId: input.recipientUserId,
          },
        },
      });

      if (!association || association.status !== TenantStudentStatus.ACTIVE) {
        throw new StudentRequiredError();
      }
      return;
    }

    if (user.platformRole === PlatformRole.INSTRUCTOR) {
      const membership = await tx.tenantMembership.findUnique({
        where: {
          tenantId_userId: {
            tenantId: input.tenantId,
            userId: input.recipientUserId,
          },
        },
        include: { tenant: true },
      });

      if (
        !membership ||
        membership.status !== TenantMembershipStatus.ACTIVE ||
        membership.tenant.status !== TenantStatus.ACTIVE
      ) {
        throw new InstructorRequiredError();
      }
      return;
    }

    throw new StudentRequiredError();
  }

  private async lockDomainNotification(
    tx: PrismaTransactionClient,
    type: string,
    domainEntityId: string,
  ): Promise<void> {
    const key = `notification:${type}:${domainEntityId}`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0::bigint))`;
  }
}

function toNotificationSummary(notification: Notification): NotificationSummary {
  return {
    notificationId: notification.id,
    type: notification.type,
    category: notification.category,
    title: notification.title,
    body: notification.body,
    domainEntityType: notification.domainEntityType,
    domainEntityId: notification.domainEntityId,
    read: notification.readAt !== null,
    readAt: notification.readAt,
    createdAt: notification.createdAt,
  };
}
