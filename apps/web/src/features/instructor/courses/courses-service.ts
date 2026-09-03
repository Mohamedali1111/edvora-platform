"use client";

import { useEffect, useState } from "react";
import type { ApiClient } from "../../../lib/api/client";
import { getAuthService } from "../../../lib/api/session";
import type { CourseSummary, CreateCourseRequest, OffsetPage, UpdateCourseRequest } from "../../../lib/api/types";

/** Bounded page size for the courses list - never fetched or aggregated beyond one page at a time. */
export const COURSES_PAGE_SIZE = 20;

export function listCourses(
  api: ApiClient,
  tenantId: string,
  params: { limit: number; offset: number },
): Promise<OffsetPage<CourseSummary>> {
  return api.request<OffsetPage<CourseSummary>>(`/instructor/tenants/${tenantId}/courses?limit=${params.limit}&offset=${params.offset}`);
}

export function getCourse(api: ApiClient, tenantId: string, courseId: string): Promise<CourseSummary> {
  return api.request<CourseSummary>(`/instructor/tenants/${tenantId}/courses/${courseId}`);
}

export function createCourse(api: ApiClient, tenantId: string, body: CreateCourseRequest): Promise<CourseSummary> {
  return api.request<CourseSummary>(`/instructor/tenants/${tenantId}/courses`, {
    method: "POST",
    body,
  });
}

export function updateCourse(api: ApiClient, tenantId: string, courseId: string, body: UpdateCourseRequest): Promise<CourseSummary> {
  return api.request<CourseSummary>(`/instructor/tenants/${tenantId}/courses/${courseId}`, {
    method: "PATCH",
    body,
  });
}

export function publishCourse(api: ApiClient, tenantId: string, courseId: string): Promise<CourseSummary> {
  return api.request<CourseSummary>(`/instructor/tenants/${tenantId}/courses/${courseId}/publish`, {
    method: "POST",
  });
}

export function archiveCourse(api: ApiClient, tenantId: string, courseId: string): Promise<CourseSummary> {
  return api.request<CourseSummary>(`/instructor/tenants/${tenantId}/courses/${courseId}/archive`, {
    method: "POST",
  });
}

/** Take Offline: PUBLISHED -> DRAFT. Non-cascading, reversible via `publishCourse` again (DEC-0048 2026-09-03 addendum). */
export function unpublishCourse(api: ApiClient, tenantId: string, courseId: string): Promise<CourseSummary> {
  return api.request<CourseSummary>(`/instructor/tenants/${tenantId}/courses/${courseId}/unpublish`, {
    method: "POST",
  });
}

/** Restore: ARCHIVED -> DRAFT. Never resurrects straight to PUBLISHED (DEC-0048 2026-09-03 addendum). */
export function restoreCourse(api: ApiClient, tenantId: string, courseId: string): Promise<CourseSummary> {
  return api.request<CourseSummary>(`/instructor/tenants/${tenantId}/courses/${courseId}/restore`, {
    method: "POST",
  });
}

export type CoursesListLoadState =
  | { status: "loading" }
  | { status: "ready"; data: OffsetPage<CourseSummary> }
  | { status: "error"; error: unknown };

/**
 * `tenantId` must always come from the authenticated instructor's tenant
 * context (useAuthenticatedInstructorSession), never from a route param -
 * a course id in the URL selects a resource, it never authorizes a tenant.
 */
export function useCoursesList(tenantId: string, offset: number): { state: CoursesListLoadState; retry: () => void } {
  const [state, setState] = useState<CoursesListLoadState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const key = `${tenantId}:${offset}:${attempt}`;
  const [trackedKey, setTrackedKey] = useState(key);

  if (trackedKey !== key) {
    setTrackedKey(key);
    setState({ status: "loading" });
  }

  useEffect(() => {
    let cancelled = false;

    listCourses(getAuthService().getClient(), tenantId, { limit: COURSES_PAGE_SIZE, offset })
      .then((data) => {
        if (!cancelled) {
          setState({ status: "ready", data });
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
  }, [tenantId, offset, attempt]);

  return { state, retry: () => setAttempt((value) => value + 1) };
}

export type CourseDetailLoadState =
  | { status: "loading" }
  | { status: "ready"; data: CourseSummary }
  | { status: "error"; error: unknown };

export function useCourseDetail(tenantId: string, courseId: string): { state: CourseDetailLoadState; retry: () => void } {
  const [state, setState] = useState<CourseDetailLoadState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const key = `${tenantId}:${courseId}:${attempt}`;
  const [trackedKey, setTrackedKey] = useState(key);

  if (trackedKey !== key) {
    setTrackedKey(key);
    setState({ status: "loading" });
  }

  useEffect(() => {
    let cancelled = false;

    getCourse(getAuthService().getClient(), tenantId, courseId)
      .then((data) => {
        if (!cancelled) {
          setState({ status: "ready", data });
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
