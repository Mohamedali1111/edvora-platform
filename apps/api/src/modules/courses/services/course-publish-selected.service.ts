import { Injectable } from '@nestjs/common';
import { CourseStatus, LessonStatus, QuizStatus, SectionStatus } from '../../../../.generated/prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import type { AuthenticatedPrincipal } from '../../auth/http/authenticated-principal';
import { ClockService } from '../../auth/services/clock.service';
import { lockQuizPublicationBoundary, quizPublishabilitySelect } from '../../quizzes/services/quiz-publishability.util';
import { TenantAuthorizationService } from '../../tenancy/services/tenant-authorization.service';
import {
  CourseAlreadyPublishedOnceError,
  CourseDataIntegrityError,
  CourseNotFoundError,
  InvalidCourseLifecycleTransitionError,
  LessonNotFoundError,
  PublishSelectionStaleError,
  SectionNotFoundError,
} from '../errors/course.errors';
import type { ReadinessIssue } from '../types/course-readiness.types';
import type { PublishSelectedResult } from '../types/course-publish-selected.types';
import { evaluateLessonContentBlockers, type LessonContentRow } from './course-readiness.util';
import {
  deriveSortedRequiredQuizIds,
  evaluateLessonLifecycleBlockers,
  evaluateSectionLifecycleBlockers,
  evaluateStructuralSelectionBlockers,
} from './course-publish-selected.util';

export type PublishSelectedInput = {
  principal: AuthenticatedPrincipal;
  tenantId: string;
  courseId: string;
  sectionIds: string[];
  lessonIds: string[];
};

/**
 * `POST .../courses/:courseId/publish-selected` — the first-publish orchestration action. The
 * Instructor reviews `GET .../readiness`'s `readyToPublish` candidate set and explicitly selects
 * exactly which currently-DRAFT Sections/Lessons should go live; this publishes exactly that reviewed
 * selection, atomically, deriving and publishing any DRAFT Quiz a selected QUIZ Lesson still needs.
 *
 * ## First-publish only
 * Valid only while `Course.publishedAt === null` (never published before). `publishedAt` is set
 * exactly once — the first time `CourseService.publishCourse()` transitions DRAFT -> PUBLISHED — and
 * is never cleared again by Take Offline (`unpublishCourse`, PUBLISHED -> DRAFT) or Restore
 * (`restoreCourse`, ARCHIVED -> DRAFT): neither touches `publishedAt` at all (confirmed by reading
 * every Course-mutating method in `CourseService`). So `publishedAt !== null` is a permanently safe
 * "has been published before" signal, even though a *republish* through the existing granular
 * `/publish` endpoint after Take Offline does overwrite `publishedAt` with a fresh timestamp — that
 * existing behavior is unrelated and unchanged here; this method never reads or writes `publishedAt`
 * a second time. A Course in that "published before, currently Draft again" state must use the
 * existing granular `/publish` endpoint ("make live again"), not this one — this method rejects it
 * with `COURSE_ALREADY_PUBLISHED_ONCE`, the same as an already-`PUBLISHED` Course.
 *
 * ## Explicit inclusion, never expanded
 * Every query in this method is bounded by the submitted `sectionIds`/`lessonIds` or by Quiz IDs
 * server-derived from the submitted Lessons' own `quizLesson` relations — never a "find every Draft
 * row" sweep. A Lesson/Section/Quiz that is not submitted (or not referenced by a submitted Lesson) is
 * never read, and therefore never mutated, no matter how "ready" it independently is.
 *
 * ## Ownership, structural rule, and staleness
 * Every submitted ID must belong to this Course/tenant (existence proven via a bounded batch fetch;
 * a wrong-course/foreign/nonexistent ID collapses to the existing non-leaking `SectionNotFoundError`/
 * `LessonNotFoundError`, never a distinguishing "belongs to another course" message). A submitted
 * Section/Lesson that exists but is not currently `DRAFT` (already `PUBLISHED` or `ARCHIVED`) is
 * treated as a stale selection, not silently dropped. The approved structural invariant — a selected
 * Lesson's Section must either also be selected or already be `PUBLISHED` — is enforced without ever
 * auto-including the missing Section. Every selected Lesson's exact content is revalidated inside this
 * transaction via `evaluateLessonContentBlockers`, the exact same evaluator `GET .../readiness` uses —
 * one source of truth, never a second, divergent publishability definition. Any single failure rejects
 * the ENTIRE selection atomically (`PUBLISH_SELECTION_STALE`, 409, with the current blockers in the
 * exact `ReadinessIssue` shape); nothing publishes.
 *
 * ## Quiz derivation
 * A selected QUIZ Lesson's Quiz ID is always resolved from its own live `quizLesson` relation, never
 * accepted from the client. Every distinct required Quiz ID is locked, in sorted order, via the
 * existing `lockQuizPublicationBoundary` — matching the established "acquire Quiz locks in sorted
 * quizId order for multiple quizzes" convention — strictly before this method reads or validates any
 * Quiz aggregate, closing the same publish-vs-mutation race that lock already exists to close (see its
 * docstring) against a concurrent Question/Option mutation on the same Quiz. An already-`PUBLISHED`
 * Quiz needs no transition; a `DRAFT` Quiz is revalidated with the exact same `evaluateQuizPublishability`
 * the Course Readiness slice introduced and `QuizService.publishQuiz()` itself enforces, and is
 * published inside this same transaction before its Lesson; an `ARCHIVED` Quiz is a stale blocker.
 *
 * ## Transaction ordering / locking
 * 1. Authorize, then read the Course and apply the not-found/archived/already-published-once gates.
 * 2. Claim the Course's first-publish transition with one conditional
 *    `WHERE id/tenantId/status=DRAFT/publishedAt IS NULL -> PUBLISHED/publishedAt=now` update, and
 *    check its affected-row count. This is deliberately the *first* write in the transaction, before
 *    any Section/Lesson/Quiz is even read: the Postgres row lock it takes is held until this
 *    transaction commits or rolls back, so no concurrent `publish-selected`, `/publish`, `/archive`,
 *    `/unpublish`, or `/restore` call against this same Course can interleave with what follows, and a
 *    lost race is detected — and the whole transaction aborted — before any descendant work happens,
 *    never discovered only after Sections/Lessons/Quizzes have already been mutated.
 * 3. Batch-fetch the submitted Sections and Lessons (ownership + existence), then batch-fetch the
 *    additional Sections referenced only by a selected Lesson's own `sectionId` (for the structural
 *    rule) and the Quizzes referenced by selected QUIZ Lessons (after their locks, per above).
 * 4. Revalidate everything against this fresh, in-transaction read; on any failure, throw
 *    `PublishSelectionStaleError` — the transaction rolls back, undoing the Course claim from step 2
 *    too, so the Course provably stays DRAFT/`publishedAt = null`.
 * 5. Mutate, in this order: DRAFT Quizzes -> PUBLISHED, then submitted Sections -> PUBLISHED, then
 *    submitted Lessons -> PUBLISHED. Quiz locks were already acquired in step 3; Sections/Lessons have
 *    no advisory lock (none exists in this codebase for them), so each mutation re-checks its own
 *    affected-row count and — in the narrow window where a concurrent granular lifecycle call raced in
 *    between this transaction's read and write of the exact same row — re-derives an accurate stale
 *    blocker from a fresh read rather than silently reporting success.
 *
 * No new advisory lock is introduced for Course/Section/Lesson: the existing conditional-update +
 * affected-row-count pattern every lifecycle method in this codebase already uses is sufficient and
 * consistent, and the ordinary Postgres row lock the Course claim's own `UPDATE` takes is what closes
 * the first-publish race — see step 2 above.
 */
@Injectable()
export class CoursePublishSelectedService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly authorization: TenantAuthorizationService,
    private readonly clock: ClockService,
  ) {}

  async publishSelected(input: PublishSelectedInput): Promise<PublishSelectedResult> {
    return this.prismaService.client.$transaction(async (tx) => {
      await this.authorization.assertInstructorTenantAccess(input.principal, input.tenantId, tx);

      const now = this.clock.now();

      const course = await tx.course.findUnique({
        where: { id_tenantId: { id: input.courseId, tenantId: input.tenantId } },
        select: { id: true, status: true, publishedAt: true },
      });

      if (!course) {
        throw new CourseNotFoundError();
      }

      if (course.status === CourseStatus.ARCHIVED) {
        throw new InvalidCourseLifecycleTransitionError();
      }

      if (course.publishedAt !== null) {
        throw new CourseAlreadyPublishedOnceError();
      }

      // Claim the first-publish transition now — see the class doc comment ("Transaction
      // ordering / locking", step 2) for why this must happen before any descendant read/write.
      const claimed = await tx.course.updateMany({
        where: { id: input.courseId, tenantId: input.tenantId, status: CourseStatus.DRAFT, publishedAt: null },
        data: { status: CourseStatus.PUBLISHED, publishedAt: now },
      });

      if (claimed.count !== 1) {
        const current = await tx.course.findUniqueOrThrow({
          where: { id_tenantId: { id: input.courseId, tenantId: input.tenantId } },
          select: { status: true },
        });
        if (current.status === CourseStatus.ARCHIVED) {
          throw new InvalidCourseLifecycleTransitionError();
        }
        // Lost the first-publish race (another transaction committed first) — never silently
        // report success.
        throw new CourseAlreadyPublishedOnceError();
      }

      // Deduplicate defensively even though the DTO already rejects duplicates (`@ArrayUnique()`) —
      // this method must stay correct if ever called from another internal path.
      const submittedSectionIds = Array.from(new Set(input.sectionIds));
      const submittedLessonIds = Array.from(new Set(input.lessonIds));

      const [sections, lessons] = await Promise.all([
        tx.courseSection.findMany({
          where: { id: { in: submittedSectionIds }, courseId: input.courseId, tenantId: input.tenantId },
          select: { id: true, title: true, status: true },
        }),
        tx.lesson.findMany({
          where: { id: { in: submittedLessonIds }, courseId: input.courseId, tenantId: input.tenantId },
          select: {
            id: true,
            title: true,
            sectionId: true,
            status: true,
            type: true,
            videoLesson: {
              select: { videoAsset: { select: { id: true, processingStatus: true, failureCode: true } } },
            },
            documentLesson: {
              select: { documentAsset: { select: { id: true, processingStatus: true, failureReason: true } } },
            },
            quizLesson: { select: { quizId: true } },
          },
        }),
      ]);

      // Non-leaking ownership proof: a wrong-tenant/wrong-course/nonexistent ID simply fails to
      // appear in this bounded fetch — collapsed to the same not-found error a genuinely missing ID
      // gets, never a distinguishing "belongs to another course" message.
      if (sections.length !== submittedSectionIds.length) {
        throw new SectionNotFoundError();
      }
      if (lessons.length !== submittedLessonIds.length) {
        throw new LessonNotFoundError();
      }

      // Resolve every selected Lesson's own Section status for the structural rule — bounded to
      // exactly the Sections those Lessons reference, server-derived from their own `sectionId` FK,
      // never a course-wide sweep. Sections already fetched above are reused, not re-queried.
      const submittedSectionIdSet = new Set(submittedSectionIds);
      const sectionStatusById = new Map<string, SectionStatus>(sections.map((s) => [s.id, s.status]));
      const unresolvedSectionIds = Array.from(
        new Set(lessons.map((lesson) => lesson.sectionId).filter((id) => !sectionStatusById.has(id))),
      );

      if (unresolvedSectionIds.length > 0) {
        const referencedSections = await tx.courseSection.findMany({
          where: { id: { in: unresolvedSectionIds }, courseId: input.courseId, tenantId: input.tenantId },
          select: { id: true, status: true },
        });
        for (const section of referencedSections) {
          sectionStatusById.set(section.id, section.status);
        }
      }

      // Server-derive required Quiz IDs from the selected Lessons' own live relations (never a
      // client-supplied quizId — there is none in the request), and acquire every lock, in sorted
      // order, strictly before reading any Quiz aggregate — see the class doc comment.
      const requiredQuizIds = deriveSortedRequiredQuizIds(lessons);
      // Sequential, not Promise.all — lock acquisition order must match the sorted quizId order
      // exactly (see the class doc comment on deadlock avoidance).
      for (const quizId of requiredQuizIds) {
        await lockQuizPublicationBoundary(tx, quizId);
      }

      const quizzes =
        requiredQuizIds.length > 0
          ? await tx.quiz.findMany({
              where: { id: { in: requiredQuizIds }, tenantId: input.tenantId },
              select: { id: true, title: true, ...quizPublishabilitySelect },
            })
          : [];
      const quizById = new Map(quizzes.map((quiz) => [quiz.id, quiz]));

      const blockers: ReadinessIssue[] = [
        ...evaluateSectionLifecycleBlockers(sections),
        ...evaluateLessonLifecycleBlockers(lessons),
        ...evaluateStructuralSelectionBlockers(lessons, submittedSectionIdSet, sectionStatusById),
      ];

      for (const lesson of lessons) {
        if (lesson.status !== LessonStatus.DRAFT) {
          // Already reported via LESSON_NOT_SELECTABLE above; content readiness is moot for a
          // Lesson that is not itself a valid transition target.
          continue;
        }

        const lessonContentRow: LessonContentRow = {
          id: lesson.id,
          title: lesson.title,
          type: lesson.type,
          videoLesson: lesson.videoLesson,
          documentLesson: lesson.documentLesson,
          quizLesson: lesson.quizLesson ? { quiz: this.resolveQuizOrThrow(quizById, lesson.quizLesson.quizId) } : null,
        };

        blockers.push(...evaluateLessonContentBlockers(lessonContentRow, lesson.sectionId));
      }

      if (blockers.length > 0) {
        throw new PublishSelectionStaleError(blockers);
      }

      // ---- Mutate: Quizzes -> Sections -> Lessons, exactly the reviewed set, nothing swept in ----

      const publishedQuizIds: string[] = [];

      for (const quizId of requiredQuizIds) {
        const quiz = this.resolveQuizOrThrow(quizById, quizId);
        if (quiz.status !== QuizStatus.DRAFT) {
          continue;
        }

        const updated = await tx.quiz.updateMany({
          where: { id: quizId, tenantId: input.tenantId, status: QuizStatus.DRAFT },
          data: { status: QuizStatus.PUBLISHED, publishedAt: now },
        });

        if (updated.count !== 1) {
          // We have held this Quiz's advisory lock since before we validated it, so no concurrent
          // writer could have changed it since — this is a genuine "should never happen" integrity
          // signal, not an expected race.
          throw new CourseDataIntegrityError();
        }

        publishedQuizIds.push(quizId);
      }

      if (submittedSectionIds.length > 0) {
        const updatedSections = await tx.courseSection.updateMany({
          where: {
            id: { in: submittedSectionIds },
            courseId: input.courseId,
            tenantId: input.tenantId,
            status: SectionStatus.DRAFT,
          },
          data: { status: SectionStatus.PUBLISHED },
        });

        if (updatedSections.count !== submittedSectionIds.length) {
          const recheck = await tx.courseSection.findMany({
            where: { id: { in: submittedSectionIds }, courseId: input.courseId, tenantId: input.tenantId },
            select: { id: true, title: true, status: true },
          });
          throw new PublishSelectionStaleError(evaluateSectionLifecycleBlockers(recheck));
        }
      }

      const updatedLessons = await tx.lesson.updateMany({
        where: {
          id: { in: submittedLessonIds },
          courseId: input.courseId,
          tenantId: input.tenantId,
          status: LessonStatus.DRAFT,
        },
        data: { status: LessonStatus.PUBLISHED },
      });

      if (updatedLessons.count !== submittedLessonIds.length) {
        const recheck = await tx.lesson.findMany({
          where: { id: { in: submittedLessonIds }, courseId: input.courseId, tenantId: input.tenantId },
          select: { id: true, title: true, sectionId: true, status: true },
        });
        throw new PublishSelectionStaleError(evaluateLessonLifecycleBlockers(recheck));
      }

      return {
        courseId: input.courseId,
        status: CourseStatus.PUBLISHED,
        published: {
          sectionIds: submittedSectionIds,
          lessonIds: submittedLessonIds,
          quizIds: publishedQuizIds,
        },
      };
    });
  }

  private resolveQuizOrThrow<T>(quizById: Map<string, T>, quizId: string): T {
    const quiz = quizById.get(quizId);
    if (!quiz) {
      // A selected QUIZ Lesson's `quizLesson.quizId` FK always points at a real Quiz row
      // (`onDelete: Restrict`), so an ID present in `requiredQuizIds` (server-derived from that
      // exact relation) must resolve here — reached only under genuine data corruption.
      throw new CourseDataIntegrityError();
    }
    return quiz;
  }
}
