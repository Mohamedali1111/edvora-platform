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
  EnrollmentQueryFilterRequiredError,
  StudentRequiredError,
  TenantStudentNotFoundError,
} from '../errors/tenancy.errors';
import type {
  EnrollmentSummary,
  InstructorEnrollmentSummary,
  StudentEnrollmentSummary,
} from '../types/tenancy.types';
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

export type ListEnrollmentsInput = {
  principal: AuthenticatedPrincipal;
  tenantId: string;
  courseId?: string;
  studentUserId?: string;
  status?: EnrollmentStatus;
  limit: number;
  offset: number;
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

  /**
   * The one instructor-facing enrollment read: a course roster (`courseId` filter), a student's
   * enrollment history within this tenant (`studentUserId` filter), or both together (a specific
   * student's enrollment(s) for a specific course). Deliberately a single flat, filtered `GET` on
   * the existing `/instructor/tenants/:tenantId/enrollments` path rather than two new nested
   * route families — see `ListEnrollmentsQueryDto`. At least one filter is required so this never
   * becomes an unscoped "every enrollment in the tenant" read.
   *
   * Lists persisted rows as-is, including `REVOKED`/`EXPIRED` history — an enrollment row is never
   * deleted or hidden by default (`docs/TENANCY-ENROLLMENT.md`: revoke "preserves historical
   * rows"), and a student re-enrolled after revocation legitimately has multiple durable rows for
   * the same (course, student): the partial unique index
   * (`enrollments_one_active_per_student_course_key`) only forbids two simultaneously `ACTIVE`
   * rows, not multiple historical ones. An explicit `status` filter narrows this when the caller
   * wants only current/only-revoked state.
   *
   * One query for the list itself (no N+1): tenant/course/student ownership is proved first via
   * two narrow existence checks (mirroring `createEnrollment`'s and `getStudent`'s own composite-
   * key lookups), then the list itself filters/orders/paginates entirely at the database level
   * with a `select` projecting only the fields this response actually needs.
   */
  async listEnrollments(input: ListEnrollmentsInput): Promise<InstructorEnrollmentSummary[]> {
    await this.authorization.assertInstructorTenantAccess(input.principal, input.tenantId);

    if (!input.courseId && !input.studentUserId) {
      throw new EnrollmentQueryFilterRequiredError();
    }

    if (input.courseId) {
      const course = await this.prismaService.client.course.findUnique({
        where: { id_tenantId: { id: input.courseId, tenantId: input.tenantId } },
        select: { id: true },
      });

      if (!course) {
        throw new CourseNotFoundError();
      }
    }

    if (input.studentUserId) {
      const tenantStudent = await this.prismaService.client.tenantStudent.findUnique({
        where: {
          tenantId_studentUserId: { tenantId: input.tenantId, studentUserId: input.studentUserId },
        },
        select: { id: true },
      });

      if (!tenantStudent) {
        throw new TenantStudentNotFoundError();
      }
    }

    const rows = await this.prismaService.client.enrollment.findMany({
      where: {
        tenantId: input.tenantId,
        ...(input.courseId ? { courseId: input.courseId } : {}),
        ...(input.studentUserId ? { studentUserId: input.studentUserId } : {}),
        ...(input.status ? { status: input.status } : {}),
      },
      select: {
        id: true,
        tenantId: true,
        courseId: true,
        studentUserId: true,
        status: true,
        startsAt: true,
        endsAt: true,
        revokedAt: true,
        createdAt: true,
        course: { select: { title: true, status: true } },
        student: { select: { email: true, displayName: true, accountStatus: true } },
      },
      take: input.limit,
      skip: input.offset,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    });

    const now = this.clock.now();
    return rows.map((row) => toInstructorEnrollmentSummary(row, now));
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

function toInstructorEnrollmentSummary(
  row: {
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
    student: {
      email: string;
      displayName: string | null;
      accountStatus: AccountStatus;
    };
  },
  now: Date,
): InstructorEnrollmentSummary {
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
    student: {
      studentUserId: row.studentUserId,
      email: row.student.email,
      displayName: row.student.displayName,
      accountStatus: row.student.accountStatus,
    },
    // Exactly the canonical Enrollment-row entitlement predicate — see
    // `InstructorEnrollmentSummary.currentlyEffective`'s doc comment for scope/rationale.
    currentlyEffective:
      row.status === EnrollmentStatus.ACTIVE &&
      (row.startsAt === null || row.startsAt <= now) &&
      (row.endsAt === null || row.endsAt > now),
  };
}
