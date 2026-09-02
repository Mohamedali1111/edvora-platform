import { apiClient } from '@/features/auth/auth-client';
import { buildInstallationHeaders } from '@/features/device/installation-id';
import type { OffsetPage } from '@/lib/api/types';
import type { StudentCourseDetail, StudentCourseSummary } from './course-types';

/**
 * Both routes are guarded server-side by StudentDeviceGuard
 * (apps/api/src/modules/courses/http/student-course.controller.ts) exactly like the
 * device endpoints, so both need the installation-id header. Neither response is
 * cached or persisted here — every screen re-fetches from the backend, which
 * remains the sole source of entitlement truth (see content-access-recovery.ts for
 * what happens when it says access is gone).
 */

export async function fetchMyCourses(input: {
  limit: number;
  offset: number;
}): Promise<OffsetPage<StudentCourseSummary>> {
  const query = new URLSearchParams({ limit: String(input.limit), offset: String(input.offset) });

  return apiClient.request<OffsetPage<StudentCourseSummary>>(`/student/courses?${query.toString()}`, {
    headers: await buildInstallationHeaders(),
  });
}

export async function fetchCourseDetail(courseId: string): Promise<StudentCourseDetail> {
  return apiClient.request<StudentCourseDetail>(`/student/courses/${encodeURIComponent(courseId)}`, {
    headers: await buildInstallationHeaders(),
  });
}
