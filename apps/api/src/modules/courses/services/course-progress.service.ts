import { Injectable } from '@nestjs/common';
import {
  EnrollmentStatus,
  LessonProgressStatus,
  LessonStatus,
  SectionStatus,
} from '../../../../.generated/prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { trimToOffsetPage } from '../../../infrastructure/http/pagination';
import type { AuthenticatedPrincipal } from '../../auth/http/authenticated-principal';
import { ClockService } from '../../auth/services/clock.service';
import { TenantAuthorizationService } from '../../tenancy/services/tenant-authorization.service';
import { CourseNotFoundError } from '../errors/course.errors';
import type { CourseProgressRow } from '../types/course-progress.types';

export type ListCourseProgressInput = {
  principal: AuthenticatedPrincipal;
  tenantId: string;
  courseId: string;
  status?: EnrollmentStatus;
  limit: number;
  offset: number;
};

@Injectable()
export class CourseProgressService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly authorization: TenantAuthorizationService,
    private readonly clock: ClockService,
  ) {}

  /**
   * Instructor V1 course-progress report: one row per Enrollment for this Course/tenant, with a
   * derived completion count/percentage and last-activity timestamp. Read-only reporting — no new
   * persistence, no BI infrastructure.
   *
   * Denominator (`totalLessons`): exactly the Lessons currently visible to a student, using the
   * identical predicate `StudentCourseAccessService` already applies for course-structure reads
   * and manual completion (`Lesson.status === PUBLISHED`, its Section `PUBLISHED`, and within its
   * `availableFrom`/`availableUntil` window as of now) — never a count of every historical Lesson
   * row. A DRAFT/ARCHIVED Lesson, or one under an unpublished Section, was never something any
   * student could complete, so it must not count against them; a not-yet-available or
   * already-unavailable Lesson is excluded the same way it is excluded from what a student can
   * currently see. This denominator is computed once, from the Course's current Lesson set, and
   * shared by every row in the page — it is not necessarily stable over time (it moves as Lessons
   * publish/unpublish or enter/leave their availability window), which is the deliberate,
   * documented trade-off of aligning with live student-access semantics rather than a frozen
   * historical count.
   *
   * Numerator (`completedLessons`): existing `LessonProgress` truth only — a count of that
   * Enrollment's `COMPLETED` rows whose Lesson is in the denominator's current Lesson set (so
   * `completedLessons` can never exceed `totalLessons`). Never inferred from QuizAttempt
   * existence, document access, or video playback; `LessonProgress` is the one source of truth
   * for lesson completion already established by the Course/Quiz milestones.
   *
   * `lastActivityAt`: the later of (a) this Enrollment's latest `LessonProgress.completedAt`
   * across ALL of its progress rows (not scoped to the current Lesson set, so a completion on a
   * Lesson that has since become unavailable/archived still counts as real past activity) and
   * (b) this Enrollment's latest `QuizAttempt.updatedAt` (`QuizAttempt` rows are only ever
   * touched at start and at submit/grade — see `StudentQuizAttemptService` — so `updatedAt` is a
   * safe, real, already-persisted "last touched" signal covering both an attempt still
   * IN_PROGRESS and one already GRADED, with no new tracking field). No `startedAt`/
   * `lastAccessedAt`/watch-time field is used: those `LessonProgress` columns exist in the schema
   * for a future slice but nothing in this codebase writes them today (only `status`/`completedAt`
   * are ever set — see `StudentCourseAccessService.upsertCompletedProgress`), so reading them
   * would always yield `null` and add no real signal.
   *
   * History: lists persisted Enrollment rows for this Course as-is, `REVOKED`/`EXPIRED` included
   * by default — the same "history preserved by default, `status` narrows on request" policy
   * already established for Enrollment Visibility, reused rather than re-invented here.
   *
   * Query strategy (bounded, no N+1): (1) tenant authorization, (2) one Course existence check,
   * (3) one query for the Course's current Lesson-ID set, (4) one paginated Enrollment query for
   * the page of rows (`take: limit + 1`, trimmed to the real page via `trimToOffsetPage` — see
   * below), then — only when the trimmed page is non-empty — (5) one grouped `LessonProgress`
   * count aggregate scoped to the current Lesson set (skipped entirely when `totalLessons` is 0),
   * (6) one grouped `LessonProgress` max-`completedAt` aggregate (unscoped, for `lastActivityAt`),
   * and (7) one grouped `QuizAttempt` max-`updatedAt` aggregate. None of these scale per student
   * or per lesson — every aggregate is a single `groupBy` keyed on the page's bounded
   * `enrollmentId` list.
   *
   * `hasMore`: fetches one extra Enrollment row (`take: limit + 1`) and trims to the real page
   * with `trimToOffsetPage` — deliberately BEFORE `enrollmentIds` is built from the page for the
   * three follow-up `groupBy` aggregates above. The sentinel (limit + 1)th row, when present,
   * therefore never appears in the returned `items`, never contributes to any
   * `completedLessons`/`lastActivityAt` aggregate for the real page, and never affects
   * `totalLessons` (computed independently from the Course's Lesson set, not from the Enrollment
   * page at all). No extra `COUNT(*)` query.
   */
  async listCourseProgress(input: ListCourseProgressInput): Promise<{ items: CourseProgressRow[]; hasMore: boolean }> {
    await this.authorization.assertInstructorTenantAccess(input.principal, input.tenantId);

    const course = await this.prismaService.client.course.findUnique({
      where: { id_tenantId: { id: input.courseId, tenantId: input.tenantId } },
      select: { id: true },
    });

    if (!course) {
      throw new CourseNotFoundError();
    }

    const now = this.clock.now();

    const currentLessons = await this.prismaService.client.lesson.findMany({
      where: {
        tenantId: input.tenantId,
        courseId: input.courseId,
        status: LessonStatus.PUBLISHED,
        section: { status: SectionStatus.PUBLISHED },
        AND: [
          { OR: [{ availableFrom: null }, { availableFrom: { lte: now } }] },
          { OR: [{ availableUntil: null }, { availableUntil: { gt: now } }] },
        ],
      },
      select: { id: true },
    });
    const currentLessonIds = currentLessons.map((lesson) => lesson.id);
    const totalLessons = currentLessonIds.length;

    const enrollmentRows = await this.prismaService.client.enrollment.findMany({
      where: {
        tenantId: input.tenantId,
        courseId: input.courseId,
        ...(input.status ? { status: input.status } : {}),
      },
      select: {
        id: true,
        studentUserId: true,
        status: true,
        startsAt: true,
        endsAt: true,
        createdAt: true,
        student: { select: { email: true, displayName: true, accountStatus: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: input.limit + 1,
      skip: input.offset,
    });
    const { items: enrollments, hasMore } = trimToOffsetPage(enrollmentRows, input.limit);

    if (enrollments.length === 0) {
      return { items: [], hasMore };
    }

    const enrollmentIds = enrollments.map((enrollment) => enrollment.id);

    const [completionCounts, completionActivity, attemptActivity] = await Promise.all([
      totalLessons === 0
        ? Promise.resolve([])
        : this.prismaService.client.lessonProgress.groupBy({
            by: ['enrollmentId'],
            where: {
              tenantId: input.tenantId,
              enrollmentId: { in: enrollmentIds },
              lessonId: { in: currentLessonIds },
              status: LessonProgressStatus.COMPLETED,
            },
            _count: { _all: true },
          }),
      this.prismaService.client.lessonProgress.groupBy({
        by: ['enrollmentId'],
        where: {
          tenantId: input.tenantId,
          enrollmentId: { in: enrollmentIds },
          status: LessonProgressStatus.COMPLETED,
        },
        _max: { completedAt: true },
      }),
      this.prismaService.client.quizAttempt.groupBy({
        by: ['enrollmentId'],
        where: { tenantId: input.tenantId, enrollmentId: { in: enrollmentIds } },
        _max: { updatedAt: true },
      }),
    ]);

    const completedCountByEnrollment = new Map(completionCounts.map((row) => [row.enrollmentId, row._count._all]));
    const lastCompletionByEnrollment = new Map(completionActivity.map((row) => [row.enrollmentId, row._max.completedAt]));
    const lastAttemptByEnrollment = new Map(attemptActivity.map((row) => [row.enrollmentId, row._max.updatedAt]));

    const items = enrollments.map((enrollment) => {
      const completedLessons = completedCountByEnrollment.get(enrollment.id) ?? 0;
      const lastCompletion = lastCompletionByEnrollment.get(enrollment.id) ?? null;
      const lastAttempt = lastAttemptByEnrollment.get(enrollment.id) ?? null;

      return {
        enrollmentId: enrollment.id,
        status: enrollment.status,
        currentlyEffective:
          enrollment.status === EnrollmentStatus.ACTIVE &&
          (enrollment.startsAt === null || enrollment.startsAt <= now) &&
          (enrollment.endsAt === null || enrollment.endsAt > now),
        startsAt: enrollment.startsAt,
        endsAt: enrollment.endsAt,
        createdAt: enrollment.createdAt,
        student: {
          studentUserId: enrollment.studentUserId,
          email: enrollment.student.email,
          displayName: enrollment.student.displayName,
          accountStatus: enrollment.student.accountStatus,
        },
        completedLessons,
        totalLessons,
        progressPercent: totalLessons === 0 ? 0 : Math.round((completedLessons / totalLessons) * 10000) / 100,
        lastActivityAt: laterOf(lastCompletion, lastAttempt),
      };
    });

    return { items, hasMore };
  }
}

function laterOf(a: Date | null, b: Date | null): Date | null {
  if (!a) {
    return b;
  }
  if (!b) {
    return a;
  }
  return a > b ? a : b;
}
