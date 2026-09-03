"use client";

import { useEffect, useState } from "react";
import type { ApiClient } from "../../../../lib/api/client";
import { getAuthService } from "../../../../lib/api/session";
import type {
  CourseSectionSummary,
  CreateSectionRequest,
  SectionListResponse,
  UpdateSectionRequest,
} from "../../../../lib/api/types";

export function listSections(api: ApiClient, tenantId: string, courseId: string): Promise<SectionListResponse> {
  return api.request<SectionListResponse>(`/instructor/tenants/${tenantId}/courses/${courseId}/sections`);
}

export function createSection(
  api: ApiClient,
  tenantId: string,
  courseId: string,
  body: CreateSectionRequest,
): Promise<CourseSectionSummary> {
  return api.request<CourseSectionSummary>(`/instructor/tenants/${tenantId}/courses/${courseId}/sections`, {
    method: "POST",
    body,
  });
}

export function updateSection(
  api: ApiClient,
  tenantId: string,
  courseId: string,
  sectionId: string,
  body: UpdateSectionRequest,
): Promise<CourseSectionSummary> {
  return api.request<CourseSectionSummary>(`/instructor/tenants/${tenantId}/courses/${courseId}/sections/${sectionId}`, {
    method: "PATCH",
    body,
  });
}

export function publishSection(api: ApiClient, tenantId: string, courseId: string, sectionId: string): Promise<CourseSectionSummary> {
  return api.request<CourseSectionSummary>(`/instructor/tenants/${tenantId}/courses/${courseId}/sections/${sectionId}/publish`, {
    method: "POST",
  });
}

export function archiveSection(api: ApiClient, tenantId: string, courseId: string, sectionId: string): Promise<CourseSectionSummary> {
  return api.request<CourseSectionSummary>(`/instructor/tenants/${tenantId}/courses/${courseId}/sections/${sectionId}/archive`, {
    method: "POST",
  });
}

/** Take Offline: PUBLISHED -> DRAFT. Non-cascading, reversible via `publishSection` again. */
export function unpublishSection(api: ApiClient, tenantId: string, courseId: string, sectionId: string): Promise<CourseSectionSummary> {
  return api.request<CourseSectionSummary>(`/instructor/tenants/${tenantId}/courses/${courseId}/sections/${sectionId}/unpublish`, {
    method: "POST",
  });
}

/** Restore: ARCHIVED -> DRAFT. Never resurrects straight to PUBLISHED. */
export function restoreSection(api: ApiClient, tenantId: string, courseId: string, sectionId: string): Promise<CourseSectionSummary> {
  return api.request<CourseSectionSummary>(`/instructor/tenants/${tenantId}/courses/${courseId}/sections/${sectionId}/restore`, {
    method: "POST",
  });
}

/**
 * `sectionIds` must be exactly the current set of non-ARCHIVED section IDs for
 * this course, in the desired final order - see ordering.ts for how that set
 * and the moved order are computed. The backend is authoritative for the
 * resulting positions; callers must refetch/use this response rather than
 * trust the submitted order as final.
 */
export function reorderSections(
  api: ApiClient,
  tenantId: string,
  courseId: string,
  sectionIds: string[],
): Promise<SectionListResponse> {
  return api.request<SectionListResponse>(`/instructor/tenants/${tenantId}/courses/${courseId}/sections/reorder`, {
    method: "POST",
    body: { sectionIds },
  });
}

export type SectionsListLoadState =
  | { status: "loading" }
  | { status: "ready"; data: CourseSectionSummary[] }
  | { status: "error"; error: unknown };

/**
 * `tenantId` must always come from the authenticated instructor's tenant
 * context (useAuthenticatedInstructorSession), never from a route param - a
 * course/section id in the URL selects a resource, it never authorizes a
 * tenant. The list endpoint is unpaginated (unlike Courses/Students/
 * Enrollments) - the frozen API always returns every section for a course in
 * one response, so there is no offset/limit here.
 */
export function useSectionsList(tenantId: string, courseId: string): { state: SectionsListLoadState; retry: () => void } {
  const [state, setState] = useState<SectionsListLoadState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const key = `${tenantId}:${courseId}:${attempt}`;
  const [trackedKey, setTrackedKey] = useState(key);

  if (trackedKey !== key) {
    setTrackedKey(key);
    setState({ status: "loading" });
  }

  useEffect(() => {
    let cancelled = false;

    listSections(getAuthService().getClient(), tenantId, courseId)
      .then((response) => {
        if (!cancelled) {
          setState({ status: "ready", data: response.items });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({ status: "error", error });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [tenantId, courseId, attempt]);

  return { state, retry: () => setAttempt((value) => value + 1) };
}
