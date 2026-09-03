import {
  AssetProcessingStatus,
  LessonStatus,
  LessonType,
  QuizStatus,
  SectionStatus,
} from '../../../../.generated/prisma/client';
import {
  evaluateQuizPublishability,
  type QuizPublishabilityRow,
} from '../../quizzes/services/quiz-publishability.util';
import { CourseDataIntegrityError } from '../errors/course.errors';
import type { CourseReadiness, ReadinessIssue, ReadyToPublish } from '../types/course-readiness.types';

export type ReadinessVideoAssetRow = {
  id: string;
  processingStatus: AssetProcessingStatus;
  failureCode: string | null;
};

export type ReadinessDocumentAssetRow = {
  id: string;
  processingStatus: AssetProcessingStatus;
  failureReason: string | null;
};

export type ReadinessQuizRow = QuizPublishabilityRow & {
  id: string;
  title: string;
};

export type ReadinessLessonRow = {
  id: string;
  title: string;
  status: LessonStatus;
  type: LessonType;
  availableFrom: Date | null;
  availableUntil: Date | null;
  videoLesson: { videoAsset: ReadinessVideoAssetRow } | null;
  documentLesson: { documentAsset: ReadinessDocumentAssetRow } | null;
  quizLesson: { quiz: ReadinessQuizRow } | null;
};

export type ReadinessSectionRow = {
  id: string;
  title: string;
  status: SectionStatus;
  lessons: ReadinessLessonRow[];
};

/**
 * Pure, DB-free derivation of Course Readiness from the exact Section/Lesson/Quiz/VideoAsset/
 * DocumentAsset rows a Course's own structure references — see `CourseReadinessService` for the
 * bounded Prisma read that produces `sections`. No tenant-wide media/quiz list is ever consulted,
 * which is the whole point: the prior client-side derivation resolved asset state against a single
 * paginated page of the tenant's Media list and silently treated anything outside that page as
 * unknown/not-ready. Reading each Lesson's own `videoLesson`/`documentLesson`/`quizLesson` relation
 * instead makes that class of bug structurally impossible, regardless of how many other assets the
 * tenant has.
 *
 * CORE DISTINCTION — lifecycle state vs content readiness: `readyToPublish` exists to feed the future
 * `POST .../courses/:courseId/publish-selected`, which the instructor uses to explicitly select which
 * currently-DRAFT Sections/Lessons should transition to PUBLISHED. A DRAFT Section/Lesson is therefore
 * the *expected, normal* state of a first-publish candidate, never a blocker by itself — a brand-new
 * Course (`Course DRAFT -> Section DRAFT -> Lesson DRAFT -> VideoAsset READY`) must be a valid
 * candidate without the instructor first manually publishing the Section and Lesson one click at a
 * time; that would recreate exactly the multi-click workflow this endpoint exists to remove. There is
 * accordingly no `SECTION_DRAFT`/`LESSON_DRAFT` reason code — see `CourseReadinessReasonCode`'s doc
 * comment. "Content-ready" (VideoAsset/DocumentAsset `READY`, Quiz aggregate-valid) is a genuinely
 * separate concept from lifecycle status, and only content issues are reported as blockers.
 *
 * Candidacy rules (each evaluated from this Course's own data, no cross-entity gating beyond what is
 * stated):
 * - Lesson: `status === DRAFT` AND belongs to a non-ARCHIVED Section AND its referenced content is
 *   "content-ready" (see below). An already-`PUBLISHED` Lesson is deliberately never a candidate — it
 *   is already live and needs no transition, so publish-selected has nothing to do to it; its own
 *   parent Section's status is irrelevant to a Lesson's own candidacy (a `DRAFT` ready Lesson under an
 *   already-`PUBLISHED` Section is still a valid candidate on its own, needing only itself selected,
 *   not its Section — matching the future publish-selected contract's "a selected Lesson's Section
 *   must either be included in selected sectionIds OR already be PUBLISHED" rule).
 * - Section: `status === DRAFT` AND it contains at least one candidate Lesson (by the rule above). An
 *   already-`PUBLISHED` Section is never a candidate (nothing to transition); an empty or
 *   all-unready-Lesson `DRAFT` Section is never a candidate either — Section publication has no
 *   child-count prerequisite in the real backend, but blindly offering an empty/unready Section for
 *   first-publish selection would not itself deliver any student-consumable content, so it is
 *   deliberately excluded here (a genuinely empty Section is instead surfaced as the `SECTION_EMPTY`
 *   advisory).
 * - Quiz: attached to `readyToPublish.quizzes` only for a candidate QUIZ Lesson whose Quiz is still
 *   `DRAFT` — i.e. exactly the Quiz publish-selected will need to transition to `PUBLISHED` as a
 *   server-side side effect of publishing its Lesson. An already-`PUBLISHED` Quiz backing a candidate
 *   Lesson needs no such transition and is not listed. Purely informational either way; the future
 *   endpoint re-resolves every reference server-side and never trusts a client-supplied ID from here.
 *
 * "Content-ready", per Lesson type, and content-issue blockers are evaluated for every non-ARCHIVED
 * Lesson regardless of its own DRAFT/PUBLISHED status (useful diagnostics for already-published
 * Course content too, e.g. a previously-`READY` video that later moved to `FAILED`):
 * - VIDEO/DOCUMENT: the referenced asset's `processingStatus === READY`.
 * - QUIZ: the referenced Quiz is not ARCHIVED and its *active* aggregate is publishable per
 *   `evaluateQuizPublishability` — the same canonical rule `QuizService.publishQuiz` enforces. This
 *   deliberately accepts an aggregate-valid `DRAFT` Quiz as content-ready, not only an
 *   already-`PUBLISHED` one: readiness describes what *could* be published as part of this Course's
 *   publish flow, not what already has been. A standalone `POST /lessons/:id/publish` call today
 *   still requires the Quiz to already be `PUBLISHED` first (see `LessonService.assertLessonPublishable`)
 *   — that narrower rule is unchanged; readiness is intentionally the broader, forward-looking view
 *   the future publish-selected flow needs.
 *
 * `ready` semantics (deliberately NOT "every descendant is ready" — V1 supports progressive
 * authoring, so a Course may legitimately carry unfinished future Draft content indefinitely): `ready`
 * is true iff `readyToPublish.lessons` is non-empty, i.e. at least one Lesson currently has actual,
 * student-consumable content that could be published right now (with its Section either already
 * `PUBLISHED` or itself a candidate). An empty or content-less `PUBLISHED` Section can never make
 * `ready` true by itself — the product needs actual publishable content, not merely a technically
 * legal empty Section, to justify "ready to publish". `blockers` still lists every unfinished/broken
 * piece elsewhere in the Course so the UI can explain it; that never by itself flips `ready` to false
 * as long as some valid Lesson candidate exists.
 */
export function evaluateCourseReadiness(
  courseId: string,
  sections: ReadinessSectionRow[],
  now: Date,
): Omit<CourseReadiness, 'computedAt'> {
  const blockers: ReadinessIssue[] = [];
  const advisories: ReadinessIssue[] = [];
  const readyToPublish: ReadyToPublish = { sections: [], lessons: [], quizzes: [] };

  for (const section of sections) {
    // Defensive, not load-bearing: `CourseReadinessService` already queries only non-ARCHIVED
    // Sections. Kept so this pure function is correct and independently testable even if a caller
    // ever passes an ARCHIVED row — ARCHIVED content is never shown to students and is excluded
    // from readiness entirely (neither a blocker nor evidence of readiness), matching the prior
    // client-side model.
    if (section.status === SectionStatus.ARCHIVED) {
      continue;
    }

    const activeLessons = section.lessons.filter((lesson) => lesson.status !== LessonStatus.ARCHIVED);

    if (activeLessons.length === 0) {
      advisories.push({
        reasonCode: 'SECTION_EMPTY',
        entityType: 'SECTION',
        entityId: section.id,
        title: section.title,
      });
    }

    let sectionHasCandidateLesson = false;

    for (const lesson of activeLessons) {
      const contentBlockers = evaluateLessonContentBlockers(lesson, section.id);
      blockers.push(...contentBlockers);

      if (lesson.availableUntil !== null && lesson.availableUntil.getTime() < now.getTime()) {
        advisories.push({
          reasonCode: 'LESSON_AVAILABILITY_WINDOW_ELAPSED',
          entityType: 'LESSON',
          entityId: lesson.id,
          parentSectionId: section.id,
          title: lesson.title,
          detail: lesson.availableUntil.toISOString(),
        });
      }

      const isCandidateLesson = lesson.status === LessonStatus.DRAFT && contentBlockers.length === 0;

      if (isCandidateLesson) {
        sectionHasCandidateLesson = true;

        readyToPublish.lessons.push({
          lessonId: lesson.id,
          sectionId: section.id,
          title: lesson.title,
          type: lesson.type,
        });

        if (lesson.type === LessonType.QUIZ && lesson.quizLesson && lesson.quizLesson.quiz.status === QuizStatus.DRAFT) {
          readyToPublish.quizzes.push({
            quizId: lesson.quizLesson.quiz.id,
            lessonId: lesson.id,
            title: lesson.quizLesson.quiz.title,
          });
        }
      }
    }

    if (section.status === SectionStatus.DRAFT && sectionHasCandidateLesson) {
      readyToPublish.sections.push({ sectionId: section.id, title: section.title });
    }
  }

  return {
    courseId,
    ready: readyToPublish.lessons.length > 0,
    blockers,
    advisories,
    readyToPublish,
  };
}

function evaluateLessonContentBlockers(lesson: ReadinessLessonRow, sectionId: string): ReadinessIssue[] {
  if (lesson.type === LessonType.VIDEO) {
    if (!lesson.videoLesson) {
      throw new CourseDataIntegrityError();
    }
    return mapVideoAssetIssues(lesson.videoLesson.videoAsset, lesson, sectionId);
  }

  if (lesson.type === LessonType.DOCUMENT) {
    if (!lesson.documentLesson) {
      throw new CourseDataIntegrityError();
    }
    return mapDocumentAssetIssues(lesson.documentLesson.documentAsset, lesson, sectionId);
  }

  if (!lesson.quizLesson) {
    throw new CourseDataIntegrityError();
  }
  return mapQuizIssues(lesson.quizLesson.quiz, lesson, sectionId);
}

function mapVideoAssetIssues(
  videoAsset: ReadinessVideoAssetRow,
  lesson: { id: string; title: string },
  sectionId: string,
): ReadinessIssue[] {
  const base = {
    entityType: 'VIDEO_ASSET' as const,
    entityId: videoAsset.id,
    parentLessonId: lesson.id,
    parentSectionId: sectionId,
    title: lesson.title,
  };

  switch (videoAsset.processingStatus) {
    case AssetProcessingStatus.READY:
      return [];
    case AssetProcessingStatus.UPLOADING:
    case AssetProcessingStatus.PROCESSING:
      return [{ ...base, reasonCode: 'VIDEO_PREPARING' }];
    case AssetProcessingStatus.FAILED:
      return [
        {
          ...base,
          reasonCode: 'VIDEO_FAILED',
          ...(videoAsset.failureCode ? { detail: videoAsset.failureCode } : {}),
        },
      ];
    case AssetProcessingStatus.ARCHIVED:
      return [{ ...base, reasonCode: 'VIDEO_ASSET_ARCHIVED' }];
    default:
      throw new CourseDataIntegrityError();
  }
}

function mapDocumentAssetIssues(
  documentAsset: ReadinessDocumentAssetRow,
  lesson: { id: string; title: string },
  sectionId: string,
): ReadinessIssue[] {
  const base = {
    entityType: 'DOCUMENT_ASSET' as const,
    entityId: documentAsset.id,
    parentLessonId: lesson.id,
    parentSectionId: sectionId,
    title: lesson.title,
  };

  switch (documentAsset.processingStatus) {
    case AssetProcessingStatus.READY:
      return [];
    case AssetProcessingStatus.UPLOADING:
    case AssetProcessingStatus.PROCESSING:
      return [{ ...base, reasonCode: 'DOCUMENT_PREPARING' }];
    case AssetProcessingStatus.FAILED:
      return [
        {
          ...base,
          reasonCode: 'DOCUMENT_FAILED',
          ...(documentAsset.failureReason ? { detail: documentAsset.failureReason } : {}),
        },
      ];
    case AssetProcessingStatus.ARCHIVED:
      return [{ ...base, reasonCode: 'DOCUMENT_ASSET_ARCHIVED' }];
    default:
      throw new CourseDataIntegrityError();
  }
}

function mapQuizIssues(
  quiz: ReadinessQuizRow,
  lesson: { id: string; title: string },
  sectionId: string,
): ReadinessIssue[] {
  const base = {
    entityType: 'QUIZ' as const,
    entityId: quiz.id,
    parentLessonId: lesson.id,
    parentSectionId: sectionId,
    title: quiz.title,
  };

  if (quiz.status === QuizStatus.ARCHIVED) {
    return [{ ...base, reasonCode: 'QUIZ_ARCHIVED' }];
  }

  return evaluateQuizPublishability(quiz).map((reasonCode) => ({ ...base, reasonCode }));
}
