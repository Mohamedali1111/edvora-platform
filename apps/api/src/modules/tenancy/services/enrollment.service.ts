import { Injectable } from '@nestjs/common';
import {
  AccountStatus,
  CourseStatus,
  EnrollmentStatus,
  PlatformRole,
  SecurityEventCategory,
  TenantStudentStatus,
} from '../../../../.generated/prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import type { AuthenticatedPrincipal } from '../../auth/http/authenticated-principal';
import { ClockService } from '../../auth/services/clock.service';
import { SecurityEventService } from '../../auth/services/security-event.service';
import { UuidV7Service } from '../../auth/services/uuid-v7.service';
import { NotificationService } from '../../notifications/services/notification.service';
import {
  CourseNotFoundError,
  EnrollmentAlreadyActiveError,
  EnrollmentNotFoundError,
  StudentRequiredError,
  TenantStudentNotFoundError,
} from '../errors/tenancy.errors';
import type { EnrollmentSummary, StudentEnrollmentSummary } from '../types/tenancy.types';
import { isKnownUniqueViolation } from './prisma-error.util';
import { TenantAuthorizationService } from './tenant-authorization.service';

export type CreateEnrollmentInput = {
  principal: AuthenticatedPrincipal;
  tenantId: string;
  studentUserId: string;
  courseId: string;
  startsAt?: Date | null;
  endsAt?: Date | null;
};

@Injectable()
export class EnrollmentService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly authorization: TenantAuthorizationService,
    private readonly securityEvents: SecurityEventService,
    private readonly notifications: NotificationService,
    private readonly clock: ClockService,
    private readonly uuid: UuidV7Service,
  ) {}

  async createEnrollment(input: CreateEnrollmentInput): Promise<EnrollmentSummary> {
    try {
      return await this.prismaService.client.$transaction(async (tx) => {
        await this.authorization.assertInstructorTenantAccess(input.principal, input.tenantId, tx);

        const now = this.clock.now();
        const [student, tenantStudent, course] = await Promise.all([
          tx.user.findUnique({
            where: { id: input.studentUserId },
            select: { accountStatus: true, platformRole: true },
          }),
          tx.tenantStudent.findUnique({
            where: {
              tenantId_studentUserId: {
                tenantId: input.tenantId,
                studentUserId: input.studentUserId,
              },
            },
          }),
          tx.course.findUnique({
            where: { id_tenantId: { id: input.courseId, tenantId: input.tenantId } },
          }),
        ]);

        if (
          !student ||
          student.platformRole !== PlatformRole.STUDENT ||
          student.accountStatus !== AccountStatus.ACTIVE
        ) {
          throw new StudentRequiredError();
        }

        if (!tenantStudent || tenantStudent.status !== TenantStudentStatus.ACTIVE) {
          throw new TenantStudentNotFoundError();
        }

        if (!course) {
          throw new CourseNotFoundError();
        }

        await tx.enrollment.updateMany({
          where: {
            studentUserId: input.studentUserId,
            courseId: input.courseId,
            status: EnrollmentStatus.ACTIVE,
            endsAt: { lte: now },
          },
          data: {
            status: EnrollmentStatus.EXPIRED,
          },
        });

        const stillActive = await tx.enrollment.findFirst({
          where: {
            studentUserId: input.studentUserId,
            courseId: input.courseId,
            status: EnrollmentStatus.ACTIVE,
          },
          select: { id: true },
        });

        if (stillActive) {
          throw new EnrollmentAlreadyActiveError();
        }

        const enrollment = await tx.enrollment.create({
          data: {
            id: this.uuid.create(),
            tenantId: input.tenantId,
            studentUserId: input.studentUserId,
            courseId: input.courseId,
            grantedByUserId: input.principal.userId,
            status: EnrollmentStatus.ACTIVE,
            startsAt: input.startsAt ?? null,
            endsAt: input.endsAt ?? null,
            createdAt: now,
          },
          include: { course: true },
        });

        await this.securityEvents.recordWithinTransaction(tx, {
          eventType: 'ENROLLMENT_CREATED',
          category: SecurityEventCategory.ADMIN,
          actorUserId: input.principal.userId,
          targetUserId: input.studentUserId,
          tenantId: input.tenantId,
          metadata: {
            enrollmentId: enrollment.id,
            courseId: input.courseId,
          },
        });

        await this.notifications.createEnrollmentCreatedNotification(tx, {
          tenantId: input.tenantId,
          courseId: input.courseId,
          courseTitle: enrollment.course.title,
          enrollmentId: enrollment.id,
          studentUserId: input.studentUserId,
          now,
        });

        return toEnrollmentSummary(enrollment);
      });
    } catch (error) {
      if (
        isKnownUniqueViolation(
          error,
          'enrollments_one_active_per_student_course_key',
          'student_user_id',
          'studentUserId',
        ) &&
        (isKnownUniqueViolation(
          error,
          'enrollments_one_active_per_student_course_key',
          'course_id',
          'courseId',
        ) ||
          isKnownUniqueViolation(error, 'enrollments_one_active_per_student_course_key'))
      ) {
        throw new EnrollmentAlreadyActiveError();
      }

      throw error;
    }
  }

  async revokeEnrollment(
    principal: AuthenticatedPrincipal,
    tenantId: string,
    enrollmentId: string,
  ): Promise<EnrollmentSummary> {
    return this.prismaService.client.$transaction(async (tx) => {
      await this.authorization.assertInstructorTenantAccess(principal, tenantId, tx);

      const enrollment = await tx.enrollment.findUnique({
        where: { id_tenantId: { id: enrollmentId, tenantId } },
        include: { course: true },
      });

      if (!enrollment || enrollment.status !== EnrollmentStatus.ACTIVE) {
        throw new EnrollmentNotFoundError();
      }

      const now = this.clock.now();
      const revoked = await tx.enrollment.update({
        where: { id: enrollment.id },
        data: {
          status: EnrollmentStatus.REVOKED,
          revokedAt: now,
          revokedByUserId: principal.userId,
        },
        include: { course: true },
      });

      await this.securityEvents.recordWithinTransaction(tx, {
        eventType: 'ENROLLMENT_REVOKED',
        category: SecurityEventCategory.ADMIN,
        actorUserId: principal.userId,
        targetUserId: revoked.studentUserId,
        tenantId,
        metadata: {
          enrollmentId: revoked.id,
          courseId: revoked.courseId,
        },
      });

      return toEnrollmentSummary(revoked);
    });
  }

  async listStudentEnrollments(
    principal: AuthenticatedPrincipal,
    limit: number,
    offset: number,
  ): Promise<StudentEnrollmentSummary[]> {
    await this.authorization.assertActiveStudent(principal);

    const rows = await this.prismaService.client.enrollment.findMany({
      where: {
        studentUserId: principal.userId,
      },
      take: limit,
      skip: offset,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      include: { course: true },
    });

    return rows.map((row) => {
      const summary = toEnrollmentSummary(row);
      return {
        enrollmentId: summary.enrollmentId,
        tenantId: summary.tenantId,
        courseId: summary.courseId,
        courseTitle: summary.courseTitle,
        courseStatus: summary.courseStatus,
        status: summary.status,
        startsAt: summary.startsAt,
        endsAt: summary.endsAt,
        revokedAt: summary.revokedAt,
        createdAt: summary.createdAt,
      };
    });
  }
}

function toEnrollmentSummary(row: {
  id: string;
  tenantId: string;
  courseId: string;
  studentUserId: string;
  status: EnrollmentStatus;
  startsAt: Date | null;
  endsAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  course: {
    title: string;
    status: CourseStatus;
  };
}): EnrollmentSummary {
  return {
    enrollmentId: row.id,
    tenantId: row.tenantId,
    courseId: row.courseId,
    courseTitle: row.course.title,
    courseStatus: row.course.status,
    studentUserId: row.studentUserId,
    status: row.status,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
  };
}
