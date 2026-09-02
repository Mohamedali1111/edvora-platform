import { apiClient } from '@/features/auth/auth-client';
import { buildInstallationHeaders } from '@/features/device/installation-id';
import { fetchCourseDetail } from '../course-client';
import type { StudentLessonProgressSummary } from './completion-types';

/**
 * The one client every completion-capable lesson screen (VIDEO, DOCUMENT) shares
 * — never duplicated per screen. StudentDeviceGuard-protected exactly like every
 * other student content route, so it needs the same installation-id header (see
 * apps/api/src/modules/courses/http/student-course.controller.ts). QUIZ never
 * calls this: a graded attempt is the only authoritative path to Quiz Lesson
 * completion (see quiz/quiz-client.ts's `submitQuizAttempt` doc comment).
 *
 * The backend upsert this hits is idempotent by construction
 * (`StudentCourseAccessService.upsertCompletedProgress`): a repeat call for an
 * already-COMPLETED lesson returns the same stable row, never re-stamping
 * `completedAt` or erroring. This client itself adds no client-generated
 * idempotency token — none is needed, and the milestone spec is explicit that
 * one must not be invented.
 */
export async function completeLesson(courseId: string, lessonId: string): Promise<StudentLessonProgressSummary> {
  return apiClient.request<StudentLessonProgressSummary>(
    `/student/courses/${encodeURIComponent(courseId)}/lessons/${encodeURIComponent(lessonId)}/complete`,
    { method: 'POST', headers: await buildInstallationHeaders() },
  );
}

/**
 * The reconciliation read used only after an ambiguous (network-kind)
 * completion failure — see use-lesson-completion.ts's "ambiguous" branch and
 * the milestone spec's "Network Ambiguity" section. Deliberately reuses the
 * exact same Course Detail read every other screen already uses for
 * authoritative progress (`fetchCourseDetail`), never a bespoke "check one
 * lesson's progress" endpoint (no such endpoint exists on the frozen backend
 * contract). A lesson missing from the response (foreign/unavailable) reads
 * as not-completed here, same as everywhere else in this app.
 */
export async function isLessonCompleted(courseId: string, lessonId: string): Promise<boolean> {
  const detail = await fetchCourseDetail(courseId);
  const lesson = detail.sections.flatMap((section) => section.lessons).find((row) => row.lessonId === lessonId);
  return lesson?.progress.status === 'COMPLETED';
}
