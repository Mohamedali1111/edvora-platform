import type { LessonProgressStatus } from '../course-types';

// Mirrors apps/api/src/modules/courses/types/student-course.types.ts's
// StudentLessonProgressSummary exactly — the response shape of
// POST /student/courses/:courseId/lessons/:lessonId/complete. This is the one
// authoritative read-back of the row the backend just wrote (or left
// untouched, if it was already COMPLETED): `status` is always 'COMPLETED' on
// a successful response, since the endpoint only ever resolves 2xx after its
// idempotent upsert commits.
export type StudentLessonProgressSummary = {
  lessonId: string;
  status: LessonProgressStatus;
  completedAt: string | null;
};
