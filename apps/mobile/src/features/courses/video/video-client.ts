import { apiClient } from '@/features/auth/auth-client';
import { buildInstallationHeaders } from '@/features/device/installation-id';
import type { VideoAccessResponse } from './video-types';

/**
 * GET /student/courses/:courseId/lessons/:lessonId/video/access — StudentDeviceGuard-
 * protected exactly like every other student content route, so it needs the same
 * installation-id header. Pure, side-effect-free on the backend (never mutates
 * progress/enrollment — see StudentVideoAccessService's doc comment) and issues a
 * fresh short-lived capability on every call; this client never caches or reuses
 * a previous response across calls.
 */
export async function fetchVideoAccess(courseId: string, lessonId: string): Promise<VideoAccessResponse> {
  return apiClient.request<VideoAccessResponse>(
    `/student/courses/${encodeURIComponent(courseId)}/lessons/${encodeURIComponent(lessonId)}/video/access`,
    { headers: await buildInstallationHeaders() },
  );
}
