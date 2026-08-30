import { Injectable } from '@nestjs/common';
import {
  AssetProcessingStatus,
  CourseStatus,
  EnrollmentStatus,
  LessonStatus,
  LessonType,
  Prisma,
  QuizStatus,
  SectionStatus,
  TenantStatus,
  TenantStudentStatus,
} from '../../../../.generated/prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import type { AuthenticatedPrincipal } from '../../auth/http/authenticated-principal';
import { ClockService } from '../../auth/services/clock.service';
import { TenantAuthorizationService } from '../../tenancy/services/tenant-authorization.service';
import { CourseNotFoundError } from '../errors/course.errors';
import type {
  StudentCourseDetail,
  StudentCourseSummary,
  StudentLessonSummary,
  StudentSectionSummary,
} from '../types/student-course.types';

const LESSON_DETAIL_INCLUDE = {
  videoLesson: {
    include: { videoAsset: { select: { processingStatus: true, durationSeconds: true } } },
  },
  documentLesson: {
    include: { documentAsset: { select: { fileName: true, mimeType: true, fileSizeBytes: true } } },
  },
  quizLesson: { include: { quiz: { select: { title: true, status: true } } } },
} as const;

type CourseSummaryRow = {
  id: string;
  tenantId: string;
  title: string;
  description: string | null;
  thumbnailAssetRef: string | null;
};

type LessonRow = {
  id: string;
  sectionId: string;
  title: string;
  description: string | null;
  type: LessonType;
  position: number;
  videoLesson: { videoAsset: { processingStatus: AssetProcessingStatus; durationSeconds: number | null } } | null;
  documentLesson: { documentAsset: { fileName: string; mimeType: string; fileSizeBytes: bigint } } | null;
  quizLesson: { quiz: { title: string; status: QuizStatus } } | null;
};

type SectionRow = {
  id: string;
  title: string;
  description: string | null;
  position: number;
  lessons: LessonRow[];
};

type CourseDetailRow = CourseSummaryRow & { sections: SectionRow[] };

@Injectable()
export class StudentCourseAccessService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly authorization: TenantAuthorizationService,
    private readonly clock: ClockService,
  ) {}

  async listEntitledCourses(
    principal: AuthenticatedPrincipal,
    limit: number,
    offset: number,
  ): Promise<StudentCourseSummary[]> {
    await this.authorization.assertActiveStudent(principal);

    const now = this.clock.now();
    const enrollments = await this.prismaService.client.enrollment.findMany({
      where: this.entitlementWhere(principal.userId, now),
      select: { course: true },
      take: limit,
      skip: offset,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    });

    return enrollments.map((row) => toStudentCourseSummary(row.course));
  }

  async getCourseStructure(
    principal: AuthenticatedPrincipal,
    courseId: string,
  ): Promise<StudentCourseDetail> {
    await this.assertStudentCourseAccess(principal, courseId);

    const now = this.clock.now();
    const course: CourseDetailRow = await this.prismaService.client.course.findUniqueOrThrow({
      where: { id: courseId },
      include: {
        sections: {
          where: { status: SectionStatus.PUBLISHED },
          orderBy: { position: 'asc' },
          include: {
            lessons: {
              where: {
                status: LessonStatus.PUBLISHED,
                AND: [
                  { OR: [{ availableFrom: null }, { availableFrom: { lte: now } }] },
                  { OR: [{ availableUntil: null }, { availableUntil: { gt: now } }] },
                ],
              },
              orderBy: { position: 'asc' },
              include: LESSON_DETAIL_INCLUDE,
            },
          },
        },
      },
    });

    return toStudentCourseDetail(course);
  }

  /**
   * Proves the authenticated student is currently entitled to read the given course:
   * DB-fresh ACTIVE STUDENT -> a currently entitled ACTIVE Enrollment (status and time window)
   * -> an ACTIVE TenantStudent for that course's own tenant -> Course PUBLISHED in an ACTIVE
   * tenant. The tenant is always derived from the course/enrollment relationship itself, never
   * from a client-supplied value. Every rejection reason (course does not exist, belongs to a
   * different tenant than the student's association, is DRAFT/ARCHIVED, has no entitled
   * enrollment, enrollment is time-expired, tenant is inactive) collapses to the same
   * `CourseNotFoundError` so a wrong, foreign, or currently-unentitled course ID cannot be
   * distinguished from "does not exist."
   */
  private async assertStudentCourseAccess(
    principal: AuthenticatedPrincipal,
    courseId: string,
  ): Promise<void> {
    await this.authorization.assertActiveStudent(principal);

    const now = this.clock.now();
    const entitled = await this.prismaService.client.enrollment.findFirst({
      where: { ...this.entitlementWhere(principal.userId, now), courseId },
      select: { id: true },
    });

    if (!entitled) {
      throw new CourseNotFoundError();
    }
  }

  /**
   * The shared entitlement predicate: ACTIVE Enrollment whose time window currently covers
   * `now`, for a Course that is PUBLISHED in an ACTIVE Tenant, associated with an ACTIVE
   * TenantStudent. This is a pure read — it never mutates a stale-but-still-ACTIVE Enrollment
   * row, unlike instructor-side enrollment creation, which opportunistically expires stale rows
   * as a side effect. An authorization read must never have a write side effect.
   */
  private entitlementWhere(studentUserId: string, now: Date): Prisma.EnrollmentWhereInput {
    return {
      studentUserId,
      status: EnrollmentStatus.ACTIVE,
      AND: [
        { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
        { OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
      ],
      course: { status: CourseStatus.PUBLISHED, tenant: { status: TenantStatus.ACTIVE } },
      tenantStudent: { status: TenantStudentStatus.ACTIVE },
    };
  }
}

function toStudentCourseSummary(course: CourseSummaryRow): StudentCourseSummary {
  return {
    courseId: course.id,
    tenantId: course.tenantId,
    title: course.title,
    description: course.description,
    thumbnailAssetRef: course.thumbnailAssetRef,
  };
}

function toStudentCourseDetail(course: CourseDetailRow): StudentCourseDetail {
  return {
    ...toStudentCourseSummary(course),
    sections: course.sections.map(
      (section): StudentSectionSummary => ({
        sectionId: section.id,
        title: section.title,
        description: section.description,
        position: section.position,
        lessons: section.lessons.map(toStudentLessonSummary),
      }),
    ),
  };
}

function toStudentLessonSummary(lesson: LessonRow): StudentLessonSummary {
  return {
    lessonId: lesson.id,
    sectionId: lesson.sectionId,
    title: lesson.title,
    description: lesson.description,
    type: lesson.type,
    position: lesson.position,
    video: lesson.videoLesson
      ? {
          processingStatus: lesson.videoLesson.videoAsset.processingStatus,
          durationSeconds: lesson.videoLesson.videoAsset.durationSeconds,
        }
      : null,
    document: lesson.documentLesson
      ? {
          fileName: lesson.documentLesson.documentAsset.fileName,
          mimeType: lesson.documentLesson.documentAsset.mimeType,
          fileSizeBytes: lesson.documentLesson.documentAsset.fileSizeBytes.toString(),
        }
      : null,
    quiz: lesson.quizLesson
      ? { title: lesson.quizLesson.quiz.title, status: lesson.quizLesson.quiz.status }
      : null,
  };
}
