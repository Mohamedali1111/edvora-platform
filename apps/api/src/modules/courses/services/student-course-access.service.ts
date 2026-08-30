import { Injectable } from '@nestjs/common';
import {
  AssetProcessingStatus,
  CourseStatus,
  EnrollmentStatus,
  LessonProgressStatus,
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
import { UuidV7Service } from '../../auth/services/uuid-v7.service';
import { isKnownUniqueViolation } from '../../tenancy/services/prisma-error.util';
import { TenantAuthorizationService } from '../../tenancy/services/tenant-authorization.service';
import { CourseNotFoundError, LessonNotFoundError, QuizLessonCompletionNotAllowedError } from '../errors/course.errors';
import type {
  StudentCourseDetail,
  StudentCourseSummary,
  StudentLessonProgress,
  StudentLessonProgressSummary,
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

const LESSON_PROGRESS_CONSTRAINT = 'lesson_progress_student_user_id_lesson_id_enrollment_id_key';

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

type ProgressRow = { lessonId: string; status: LessonProgressStatus; completedAt: Date | null };

type StudentCourseAccess = { tenantId: string; enrollmentId: string };

@Injectable()
export class StudentCourseAccessService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly authorization: TenantAuthorizationService,
    private readonly clock: ClockService,
    private readonly uuid: UuidV7Service,
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
    const { enrollmentId } = await this.assertStudentCourseAccess(principal, courseId);

    const now = this.clock.now();
    const [course, progressRows] = await Promise.all([
      this.prismaService.client.course.findUniqueOrThrow({
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
      }),
      // One query for the entire course, scoped to this exact student + entitled enrollment —
      // never per-lesson. A lesson with no row here is NOT_STARTED (see toLessonProgress).
      this.prismaService.client.lessonProgress.findMany({
        where: { studentUserId: principal.userId, enrollmentId },
        select: { lessonId: true, status: true, completedAt: true },
      }),
    ]);

    const progressByLessonId = new Map(progressRows.map((row): [string, ProgressRow] => [row.lessonId, row]));
    return toStudentCourseDetail(course, progressByLessonId);
  }

  /**
   * Marks a currently-accessible, non-quiz Lesson as completed for the authenticated student.
   * Idempotent: a missing row is created COMPLETED; an existing NOT_STARTED/STARTED row
   * transitions to COMPLETED; an already-COMPLETED row is returned unchanged (no duplicate row,
   * no re-stamped `completedAt`). Ownership is entirely server-derived — `studentUserId` is
   * always `principal.userId` and `enrollmentId` is always the student's own entitled
   * enrollment for this course, never a client-supplied value.
   */
  async completeLesson(
    principal: AuthenticatedPrincipal,
    courseId: string,
    lessonId: string,
  ): Promise<StudentLessonProgressSummary> {
    const { tenantId, enrollmentId } = await this.assertStudentCourseAccess(principal, courseId);

    const now = this.clock.now();
    // Scoped by the exact (id, tenantId, courseId) already proven, plus the same
    // published-section / published-lesson / availability-window rules the read side applies —
    // a lesson that would not appear in the student's course structure cannot be completed
    // either. A mismatch on any dimension (wrong course/tenant, DRAFT/ARCHIVED, unavailable)
    // yields the same LessonNotFoundError, avoiding existence leakage.
    const lesson = await this.prismaService.client.lesson.findFirst({
      where: {
        id: lessonId,
        tenantId,
        courseId,
        status: LessonStatus.PUBLISHED,
        section: { status: SectionStatus.PUBLISHED },
        AND: [
          { OR: [{ availableFrom: null }, { availableFrom: { lte: now } }] },
          { OR: [{ availableUntil: null }, { availableUntil: { gt: now } }] },
        ],
      },
      select: { id: true, type: true },
    });

    if (!lesson) {
      throw new LessonNotFoundError();
    }

    if (lesson.type === LessonType.QUIZ) {
      throw new QuizLessonCompletionNotAllowedError();
    }

    return this.upsertCompletedProgress({
      tenantId,
      courseId,
      lessonId: lesson.id,
      studentUserId: principal.userId,
      enrollmentId,
      now,
    });
  }

  /**
   * Proves the authenticated student is currently entitled to read/act on the given course, and
   * returns the exact (tenantId, enrollmentId) pair that proof resolved to, so callers never
   * re-derive or accept these as separate client-supplied inputs. See the entitlement predicate
   * in `entitlementWhere` for the full DB-fresh chain proved: ACTIVE STUDENT -> a currently
   * entitled ACTIVE Enrollment (status and time window) -> an ACTIVE TenantStudent for that
   * course's own tenant -> Course PUBLISHED in an ACTIVE tenant. Every rejection reason
   * collapses to the same `CourseNotFoundError` so a wrong, foreign, or currently-unentitled
   * course ID cannot be distinguished from "does not exist."
   */
  private async assertStudentCourseAccess(
    principal: AuthenticatedPrincipal,
    courseId: string,
  ): Promise<StudentCourseAccess> {
    await this.authorization.assertActiveStudent(principal);

    const now = this.clock.now();
    const entitled = await this.prismaService.client.enrollment.findFirst({
      where: { ...this.entitlementWhere(principal.userId, now), courseId },
      select: { id: true, tenantId: true },
    });

    if (!entitled) {
      throw new CourseNotFoundError();
    }

    return { tenantId: entitled.tenantId, enrollmentId: entitled.id };
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

  /**
   * Attempts to create a fresh COMPLETED row first (the common case — no prior progress). If one
   * already exists, the unique constraint on (studentUserId, lessonId, enrollmentId) rejects the
   * insert; the fallback then atomically flips it to COMPLETED only if it is not already
   * COMPLETED (`updateMany` with a `status: { not: COMPLETED }` guard), so a concurrent
   * duplicate-completion race and a simple repeated call both converge to exactly one row
   * without ever re-stamping `completedAt` on an already-completed lesson.
   */
  private async upsertCompletedProgress(input: {
    tenantId: string;
    courseId: string;
    lessonId: string;
    studentUserId: string;
    enrollmentId: string;
    now: Date;
  }): Promise<StudentLessonProgressSummary> {
    try {
      const created = await this.prismaService.client.lessonProgress.create({
        data: {
          id: this.uuid.create(),
          tenantId: input.tenantId,
          courseId: input.courseId,
          lessonId: input.lessonId,
          studentUserId: input.studentUserId,
          enrollmentId: input.enrollmentId,
          status: LessonProgressStatus.COMPLETED,
          completedAt: input.now,
        },
      });

      return { lessonId: created.lessonId, status: created.status, completedAt: created.completedAt };
    } catch (error) {
      if (!isKnownUniqueViolation(error, LESSON_PROGRESS_CONSTRAINT, 'student_user_id', 'studentUserId', 'lesson_id', 'lessonId', 'enrollment_id', 'enrollmentId')) {
        throw error;
      }

      await this.prismaService.client.lessonProgress.updateMany({
        where: {
          studentUserId: input.studentUserId,
          lessonId: input.lessonId,
          enrollmentId: input.enrollmentId,
          status: { not: LessonProgressStatus.COMPLETED },
        },
        data: { status: LessonProgressStatus.COMPLETED, completedAt: input.now },
      });

      const current = await this.prismaService.client.lessonProgress.findUniqueOrThrow({
        where: {
          studentUserId_lessonId_enrollmentId: {
            studentUserId: input.studentUserId,
            lessonId: input.lessonId,
            enrollmentId: input.enrollmentId,
          },
        },
        select: { lessonId: true, status: true, completedAt: true },
      });

      return current;
    }
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

function toStudentCourseDetail(course: CourseDetailRow, progressByLessonId: Map<string, ProgressRow>): StudentCourseDetail {
  return {
    ...toStudentCourseSummary(course),
    sections: course.sections.map(
      (section): StudentSectionSummary => ({
        sectionId: section.id,
        title: section.title,
        description: section.description,
        position: section.position,
        lessons: section.lessons.map((lesson) => toStudentLessonSummary(lesson, progressByLessonId)),
      }),
    ),
  };
}

function toStudentLessonSummary(
  lesson: LessonRow,
  progressByLessonId: Map<string, ProgressRow>,
): StudentLessonSummary {
  const progress = progressByLessonId.get(lesson.id);

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
    progress: toLessonProgress(progress),
  };
}

function toLessonProgress(row: ProgressRow | undefined): StudentLessonProgress {
  return {
    status: row?.status ?? LessonProgressStatus.NOT_STARTED,
    completedAt: row?.completedAt ?? null,
  };
}
