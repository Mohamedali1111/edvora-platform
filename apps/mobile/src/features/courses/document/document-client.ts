import { apiClient } from '@/features/auth/auth-client';
import { buildInstallationHeaders } from '@/features/device/installation-id';
import type { DocumentAccessResponse } from './document-types';

/**
 * GET /student/courses/:courseId/lessons/:lessonId/document/access —
 * StudentDeviceGuard-protected exactly like every other student content
 * route, so it needs the same installation-id header. Pure, side-effect-free
 * on the backend (never mutates progress/enrollment — see
 * StudentDocumentAccessService's doc comment) and issues a fresh short-lived
 * capability on every call; this client never caches or reuses a previous
 * response across calls.
 */
export async function fetchDocumentAccess(courseId: string, lessonId: string): Promise<DocumentAccessResponse> {
  return apiClient.request<DocumentAccessResponse>(
    `/student/courses/${encodeURIComponent(courseId)}/lessons/${encodeURIComponent(lessonId)}/document/access`,
    { headers: await buildInstallationHeaders() },
  );
}
