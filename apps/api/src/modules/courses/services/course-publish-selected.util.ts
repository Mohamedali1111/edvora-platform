import { LessonStatus, LessonType, SectionStatus } from '../../../../.generated/prisma/client';
import type { ReadinessIssue } from '../types/course-readiness.types';

export type SelectionSectionRow = {
  id: string;
  title: string;
  status: SectionStatus;
};

export type SelectionLessonRow = {
  id: string;
  title: string;
  sectionId: string;
  status: LessonStatus;
  type: LessonType;
  quizLesson: { quizId: string } | null;
};

/**
 * Every submitted Section must currently be DRAFT to be a valid `DRAFT -> PUBLISHED` target. An
 * already-PUBLISHED or ARCHIVED submitted Section is treated as a stale/invalid selection (the
 * approved contract) rather than silently ignored — see `CoursePublishSelectedService`.
 */
export function evaluateSectionLifecycleBlockers(sections: readonly SelectionSectionRow[]): ReadinessIssue[] {
  return sections
    .filter((section) => section.status !== SectionStatus.DRAFT)
    .map((section) => ({
      reasonCode: 'SECTION_NOT_SELECTABLE' as const,
      entityType: 'SECTION' as const,
      entityId: section.id,
      title: section.title,
      detail: section.status,
    }));
}

/** Same rule as `evaluateSectionLifecycleBlockers`, for submitted Lessons. */
export function evaluateLessonLifecycleBlockers(
  lessons: readonly Pick<SelectionLessonRow, 'id' | 'title' | 'sectionId' | 'status'>[],
): ReadinessIssue[] {
  return lessons
    .filter((lesson) => lesson.status !== LessonStatus.DRAFT)
    .map((lesson) => ({
      reasonCode: 'LESSON_NOT_SELECTABLE' as const,
      entityType: 'LESSON' as const,
      entityId: lesson.id,
      parentSectionId: lesson.sectionId,
      title: lesson.title,
      detail: lesson.status,
    }));
}

/**
 * The approved structural invariant: a selected Lesson's Section must EITHER also be present in the
 * submitted `sectionIds` OR already be `PUBLISHED`. A DRAFT Lesson cannot sensibly go live under a
 * DRAFT Section unless that Section is part of the same reviewed publication — the server never
 * expands the Instructor's explicit selection to "fix" this by implicitly including the Section.
 * `sectionStatusById` must contain an entry for every `lesson.sectionId` referenced below (the caller
 * resolves this from a bounded, server-derived fetch — never a course-wide sweep).
 */
export function evaluateStructuralSelectionBlockers(
  lessons: readonly SelectionLessonRow[],
  submittedSectionIds: ReadonlySet<string>,
  sectionStatusById: ReadonlyMap<string, SectionStatus>,
): ReadinessIssue[] {
  const blockers: ReadinessIssue[] = [];

  for (const lesson of lessons) {
    if (submittedSectionIds.has(lesson.sectionId)) {
      continue;
    }

    if (sectionStatusById.get(lesson.sectionId) === SectionStatus.PUBLISHED) {
      continue;
    }

    blockers.push({
      reasonCode: 'LESSON_SECTION_NOT_INCLUDED',
      entityType: 'LESSON',
      entityId: lesson.id,
      parentSectionId: lesson.sectionId,
      title: lesson.title,
    });
  }

  return blockers;
}

/**
 * Every distinct Quiz ID referenced by a selected QUIZ-type Lesson, resolved from the Lesson's own
 * live `quizLesson` relation (never a client-supplied quizId — there is none in the request), sorted
 * deterministically. `CoursePublishSelectedService` acquires `lockQuizPublicationBoundary` for each of
 * these, in exactly this order, before validating or publishing any of them — matching the existing
 * "acquire Quiz locks in sorted quizId order" convention for multiple quizzes, which is what rules out
 * a deadlock between two transactions each processing an overlapping set of Quizzes in different
 * orders.
 */
export function deriveSortedRequiredQuizIds(lessons: readonly SelectionLessonRow[]): string[] {
  const quizIds = new Set<string>();

  for (const lesson of lessons) {
    if (lesson.type === LessonType.QUIZ && lesson.quizLesson) {
      quizIds.add(lesson.quizLesson.quizId);
    }
  }

  return Array.from(quizIds).sort();
}
