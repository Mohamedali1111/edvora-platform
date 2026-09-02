import { apiClient } from '@/features/auth/auth-client';
import { buildInstallationHeaders } from '@/features/device/installation-id';
import type { StudentQuizAttemptDetail, StudentQuizContent } from './quiz-types';

/**
 * All four routes are nested under the same Course/Lesson-bound Quiz path
 * (never a bare `/student/quiz-attempts/:id`) and are StudentDeviceGuard-
 * protected exactly like every other student content route, so every call
 * needs the installation-id header. See
 * apps/api/src/modules/quizzes/http/student-quiz.controller.ts and
 * student-quiz-attempt.controller.ts.
 */
function quizPath(courseId: string, lessonId: string): string {
  return `/student/courses/${encodeURIComponent(courseId)}/lessons/${encodeURIComponent(lessonId)}/quiz`;
}

/** Pure content-delivery read — never starts an attempt, never consumes attempt allowance. */
export async function fetchQuizContent(courseId: string, lessonId: string): Promise<StudentQuizContent> {
  return apiClient.request<StudentQuizContent>(quizPath(courseId, lessonId), {
    headers: await buildInstallationHeaders(),
  });
}

/**
 * Creates a new Attempt — NOT idempotent (each call increments `attemptNumber`
 * and, if the Quiz has a configured `attemptLimit`, consumes one slot of it).
 * Callers must guard against a double-tap themselves (see quiz-lesson-screen.tsx);
 * this client never retries a failed call on its own.
 */
export async function startQuizAttempt(courseId: string, lessonId: string): Promise<StudentQuizAttemptDetail> {
  return apiClient.request<StudentQuizAttemptDetail>(`${quizPath(courseId, lessonId)}/attempts`, {
    method: 'POST',
    headers: await buildInstallationHeaders(),
  });
}

export async function fetchQuizAttempt(
  courseId: string,
  lessonId: string,
  attemptId: string,
): Promise<StudentQuizAttemptDetail> {
  return apiClient.request<StudentQuizAttemptDetail>(
    `${quizPath(courseId, lessonId)}/attempts/${encodeURIComponent(attemptId)}`,
    { headers: await buildInstallationHeaders() },
  );
}

/**
 * Idempotent and retry-safe by construction on the backend (always updates the
 * one pre-existing answer row for this question, never inserts) — safe for
 * this client to call again on failure/retry without risking a duplicate.
 */
export async function saveQuizAnswer(
  courseId: string,
  lessonId: string,
  attemptId: string,
  questionId: string,
  optionId: string,
): Promise<StudentQuizAttemptDetail> {
  return apiClient.request<StudentQuizAttemptDetail>(
    `${quizPath(courseId, lessonId)}/attempts/${encodeURIComponent(attemptId)}/answers/${encodeURIComponent(questionId)}`,
    { method: 'PUT', body: { optionId }, headers: await buildInstallationHeaders() },
  );
}

/**
 * Idempotent on the backend: submitting an already-GRADED attempt returns the
 * stable persisted result unchanged (never rescored, never re-stamped) — so a
 * manual retry after an ambiguous network failure is safe and is this
 * client's only recovery path (there is no separate "check attempt state"
 * lookup needed; calling this again IS that safe lookup).
 */
export async function submitQuizAttempt(
  courseId: string,
  lessonId: string,
  attemptId: string,
): Promise<StudentQuizAttemptDetail> {
  return apiClient.request<StudentQuizAttemptDetail>(
    `${quizPath(courseId, lessonId)}/attempts/${encodeURIComponent(attemptId)}/submit`,
    { method: 'POST', headers: await buildInstallationHeaders() },
  );
}
