import type { CourseStatus } from '../../../../.generated/prisma/client';

/**
 * Success response for `POST .../courses/:courseId/publish-selected`. `published` reports exactly
 * what this request transitioned — `quizIds` is the set of previously-DRAFT Quizzes this request
 * itself published as a server-derived side effect of publishing their Lesson; an already-PUBLISHED
 * Quiz referenced by a selected Lesson does not need a transition and is not included here.
 */
export type PublishSelectedResult = {
  courseId: string;
  status: CourseStatus;
  published: {
    sectionIds: string[];
    lessonIds: string[];
    quizIds: string[];
  };
};
