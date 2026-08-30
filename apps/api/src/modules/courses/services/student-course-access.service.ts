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
import type { PrismaTransactionClient } from '../../auth/types/prisma-transaction.type';
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
   * Proves the authenticated student is entitled to read the Quiz linked to a specific,
   * currently-accessible QUIZ Lesson within an entitled Course, and returns the exact
   * (tenantId, quizId, enrollmentId) triple that proof resolved to — `enrollmentId` is included
   * because Quiz Attempt creation (Slice C) needs it and must derive it the same server-side way
   * every other entitled-student write in this codebase does, never as a client-supplied value.
   * This is a thin, lesson-shaped extension of
   * `assertStudentCourseAccess` — the one canonical entitlement chain — never a parallel
   * authorization path duplicated inside the Quiz module. A lesson that would not appear in the
   * student's course structure (foreign course, DRAFT/ARCHIVED, unpublished section, outside its
   * availability window, or not type QUIZ) cannot be resolved here either, and collapses to the
   * same `LessonNotFoundError` the read/completion paths already use — no new "not found"
   * taxonomy, no existence leakage between "does not exist" and "not currently available to
   * you." The linked Quiz itself must also be in the student-visible `PUBLISHED` state; an
   * otherwise-reachable QUIZ Lesson pointing at a DRAFT/ARCHIVED Quiz is treated exactly like an
   * unavailable lesson, never served as content.
   */
  async assertAccessibleQuizLesson(
    principal: AuthenticatedPrincipal,
    courseId: string,
    lessonId: string,
  ): Promise<{ tenantId: string; quizId: string; enrollmentId: string }> {
    const { tenantId, enrollmentId } = await this.assertStudentCourseAccess(principal, courseId);

    const now = this.clock.now();
    const lesson = await this.prismaService.client.lesson.findFirst({
      where: {
        id: lessonId,
        tenantId,
        courseId,
        type: LessonType.QUIZ,
        status: LessonStatus.PUBLISHED,
        section: { status: SectionStatus.PUBLISHED },
        AND: [
          { OR: [{ availableFrom: null }, { availableFrom: { lte: now } }] },
          { OR: [{ availableUntil: null }, { availableUntil: { gt: now } }] },
        ],
      },
      select: {
        quizLesson: { select: { quizId: true, quiz: { select: { status: true } } } },
      },
    });

    // `quizLesson.quiz` is reached through the schema's own `(quizId, tenantId) ->
    // Quiz(id, tenantId)` composite foreign key, so a resolved `quizId` is already proven to
    // belong to this exact tenant — no separate tenant-match query is needed or possible to
    // bypass.
    if (!lesson?.quizLesson || lesson.quizLesson.quiz.status !== QuizStatus.PUBLISHED) {
      throw new LessonNotFoundError();
    }

    return { tenantId, quizId: lesson.quizLesson.quizId, enrollmentId };
  }

  /**
   * Proves the authenticated student is entitled to access the document linked to a specific,
   * currently-accessible DOCUMENT Lesson within an entitled Course, and returns the exact
   * (tenantId, documentAssetId, enrollmentId) triple that proof resolved to. This is a thin,
   * lesson-shaped extension of `assertStudentCourseAccess` — the one canonical entitlement chain
   * — never a parallel authorization path duplicated inside the Media module, mirroring exactly
   * how `assertAccessibleQuizLesson` extends the same chain for QUIZ lessons. A lesson that would
   * not appear in the student's course structure (foreign course, DRAFT/ARCHIVED, unpublished
   * section, outside its availability window, or not type DOCUMENT) cannot be resolved here
   * either, and collapses to the same `LessonNotFoundError` the read/completion/quiz paths
   * already use — no new "not found" taxonomy, no existence leakage between "does not exist" and
   * "not currently available to you." `documentLesson.documentAsset` is reached through the
   * schema's own `(documentAssetId, tenantId) -> DocumentAsset(id, tenantId)` composite foreign
   * key, so a resolved `documentAssetId` is already proven to belong to this exact tenant — no
   * separate tenant-match query is needed or possible to bypass. The linked DocumentAsset must
   * also be `READY`: a document referenced by a Lesson while still `UPLOADING`/`PROCESSING`, or
   * that ended up `FAILED`/`ARCHIVED`, is treated exactly like an unavailable lesson and never
   * granted runtime access — instructor authoring may reference an asset before it is ready (see
   * Media Slice A), but that is a distinct, deliberately looser authoring-time check; this
   * runtime student-access check is stricter by design.
   */
  async assertAccessibleDocumentLesson(
    principal: AuthenticatedPrincipal,
    courseId: string,
    lessonId: string,
  ): Promise<{ tenantId: string; documentAssetId: string; enrollmentId: string }> {
    const { tenantId, enrollmentId } = await this.assertStudentCourseAccess(principal, courseId);

    const now = this.clock.now();
    const lesson = await this.prismaService.client.lesson.findFirst({
      where: {
        id: lessonId,
        tenantId,
        courseId,
        type: LessonType.DOCUMENT,
        status: LessonStatus.PUBLISHED,
        section: { status: SectionStatus.PUBLISHED },
        AND: [
          { OR: [{ availableFrom: null }, { availableFrom: { lte: now } }] },
          { OR: [{ availableUntil: null }, { availableUntil: { gt: now } }] },
        ],
      },
      select: {
        documentLesson: { select: { documentAssetId: true, documentAsset: { select: { processingStatus: true } } } },
      },
    });

    if (
      !lesson?.documentLesson ||
      lesson.documentLesson.documentAsset.processingStatus !== AssetProcessingStatus.READY
    ) {
      throw new LessonNotFoundError();
    }

    return { tenantId, documentAssetId: lesson.documentLesson.documentAssetId, enrollmentId };
  }

  /**
   * Proves the authenticated student is entitled to playback authorization for the video linked
   * to a specific, currently-accessible VIDEO Lesson within an entitled Course, and returns the
   * exact (tenantId, videoAssetId, enrollmentId, durationSeconds, providerKey, externalAssetRef)
   * tuple that proof resolved to. `providerKey`/`externalAssetRef` are the proven READY asset's own
   * provider identity, returned so a caller (`StudentVideoAccessService`) can issue a real provider
   * playback capability without ever re-querying or trusting a client-supplied identifier.
   * This is a thin, lesson-shaped extension of `assertStudentCourseAccess` — the one canonical
   * entitlement chain — never a parallel authorization path duplicated inside the Media module,
   * mirroring exactly how `assertAccessibleDocumentLesson` extends the same chain for DOCUMENT
   * lessons (which itself mirrors `assertAccessibleQuizLesson` for QUIZ lessons). A lesson that
   * would not appear in the student's course structure (foreign course, DRAFT/ARCHIVED,
   * unpublished section, outside its availability window, or not type VIDEO) cannot be resolved
   * here either, and collapses to the same `LessonNotFoundError` the read/completion/quiz/document
   * paths already use — no new "not found" taxonomy, no existence leakage between "does not
   * exist" and "not currently available to you." `videoLesson.videoAsset` is reached through the
   * schema's own `(videoAssetId, tenantId) -> VideoAsset(id, tenantId)` composite foreign key, so
   * a resolved `videoAssetId` is already proven to belong to this exact tenant — no separate
   * tenant-match query is needed or possible to bypass. The linked VideoAsset must also be
   * `READY`: a video referenced by a Lesson while still `UPLOADING`/`PROCESSING`, or that ended up
   * `FAILED`/`ARCHIVED`, is treated exactly like an unavailable lesson and never granted playback
   * authorization — instructor authoring may reference an asset before it is ready (see Media
   * Slice A), but that is a distinct, deliberately looser authoring-time check; this runtime
   * student-access check is stricter by design, exactly as established for DOCUMENT lessons in
   * Media Slice B.
   */
  async assertAccessibleVideoLesson(
    principal: AuthenticatedPrincipal,
    courseId: string,
    lessonId: string,
  ): Promise<{
    tenantId: string;
    videoAssetId: string;
    enrollmentId: string;
    durationSeconds: number | null;
    providerKey: string | null;
    externalAssetRef: string;
  }> {
    const { tenantId, enrollmentId } = await this.assertStudentCourseAccess(principal, courseId);

    const now = this.clock.now();
    const lesson = await this.prismaService.client.lesson.findFirst({
      where: {
        id: lessonId,
        tenantId,
        courseId,
        type: LessonType.VIDEO,
        status: LessonStatus.PUBLISHED,
        section: { status: SectionStatus.PUBLISHED },
        AND: [
          { OR: [{ availableFrom: null }, { availableFrom: { lte: now } }] },
          { OR: [{ availableUntil: null }, { availableUntil: { gt: now } }] },
        ],
      },
      select: {
        videoLesson: {
          select: {
            videoAssetId: true,
            videoAsset: {
              select: { processingStatus: true, durationSeconds: true, providerKey: true, externalAssetRef: true },
            },
          },
        },
      },
    });

    if (!lesson?.videoLesson || lesson.videoLesson.videoAsset.processingStatus !== AssetProcessingStatus.READY) {
      throw new LessonNotFoundError();
    }

    return {
      tenantId,
      videoAssetId: lesson.videoLesson.videoAssetId,
      enrollmentId,
      durationSeconds: lesson.videoLesson.videoAsset.durationSeconds,
      providerKey: lesson.videoLesson.videoAsset.providerKey,
      externalAssetRef: lesson.videoLesson.videoAsset.externalAssetRef,
    };
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
   * Creates a fresh COMPLETED row if none exists, or flips an existing non-COMPLETED row to
   * COMPLETED, or leaves an already-COMPLETED row completely untouched — as one atomic, native
   * PostgreSQL `INSERT ... ON CONFLICT (...) DO UPDATE ... WHERE status <> 'COMPLETED'` statement,
   * so a concurrent duplicate-completion race and a simple repeated call both converge to exactly
   * one row without ever re-stamping `completedAt` on an already-completed lesson.
   *
   * Public (not private) and takes the Prisma client/transaction to operate within, following the
   * same `client: PrismaService['client'] | PrismaTransactionClient = this.prismaService.client`
   * convention already established by `TenantAuthorizationService`: `completeLesson` below calls
   * this with no third argument (its own single-statement atomicity is enough), while
   * `StudentQuizAttemptService.submitAttempt` passes its own `tx` so attempt finalization and this
   * progress transition commit or roll back together as one atomic unit — never a state where one
   * succeeds and the other doesn't.
   *
   * This deliberately does NOT use Prisma's `create()` guarded by a caught unique-constraint
   * violation (the pattern used elsewhere in this codebase, e.g.
   * `StudentDeviceService`/`QuestionOptionService`): that pattern relies on the failed `create()`
   * being its own independent statement, which is true for the plain top-level Prisma client
   * `completeLesson` uses, but is unsafe when reused inside an already-open, multi-statement
   * transaction like `submitAttempt`'s — a caught application-level exception does not roll
   * PostgreSQL back to a safe point, so the *entire* surrounding transaction (including the
   * attempt-grading writes already made) would be left aborted, and every subsequent statement
   * in it (including this method's own fallback `updateMany`) would itself fail. A native
   * `ON CONFLICT` upsert is handled entirely inside PostgreSQL for a single statement and never
   * raises an application-level exception for the conflict case at all, so it is safe in both
   * calling contexts with no special-casing — and is exactly the reachable cross-attempt
   * concurrency case this method must also handle: two different `QuizAttempt`s (each in its own
   * transaction, each behind its own per-attempt advisory lock) can race to complete the same
   * Lesson, and PostgreSQL's own `ON CONFLICT` handling serializes that race correctly with no
   * additional locking.
   */
  async upsertCompletedProgress(
    input: {
      tenantId: string;
      courseId: string;
      lessonId: string;
      studentUserId: string;
      enrollmentId: string;
      now: Date;
    },
    client: PrismaService['client'] | PrismaTransactionClient = this.prismaService.client,
  ): Promise<StudentLessonProgressSummary> {
    const id = this.uuid.create();

    await client.$executeRaw`
      INSERT INTO "lesson_progress"
        ("id", "tenant_id", "course_id", "lesson_id", "student_user_id", "enrollment_id", "status", "completed_at", "created_at", "updated_at")
      VALUES
        (${id}::uuid, ${input.tenantId}::uuid, ${input.courseId}::uuid, ${input.lessonId}::uuid, ${input.studentUserId}::uuid, ${input.enrollmentId}::uuid, 'COMPLETED', ${input.now}, ${input.now}, ${input.now})
      ON CONFLICT ("student_user_id", "lesson_id", "enrollment_id")
      DO UPDATE SET "status" = 'COMPLETED', "completed_at" = ${input.now}, "updated_at" = ${input.now}
      WHERE "lesson_progress"."status" <> 'COMPLETED'
    `;

    // Read back through the SAME client/transaction the write just went through — reading via a
    // different connection here would not see this row if `client` is still an open, uncommitted
    // transaction (`tx`).
    return client.lessonProgress.findUniqueOrThrow({
      where: {
        studentUserId_lessonId_enrollmentId: {
          studentUserId: input.studentUserId,
          lessonId: input.lessonId,
          enrollmentId: input.enrollmentId,
        },
      },
      select: { lessonId: true, status: true, completedAt: true },
    });
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
