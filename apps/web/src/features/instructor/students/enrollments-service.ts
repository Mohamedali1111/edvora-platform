"use client";

import { useEffect, useState } from "react";
import type { ApiClient } from "../../../lib/api/client";
import { getAuthService } from "../../../lib/api/session";
import type {
  CourseSummary,
  CreateEnrollmentRequest,
  EnrollmentStatus,
  EnrollmentSummary,
  InstructorEnrollmentSummary,
  OffsetPage,
} from "../../../lib/api/types";

/** Bounded page sizes - never fetched or aggregated beyond one page at a time. */
export const ENROLLMENTS_PAGE_SIZE = 10;
export const COURSE_SELECTOR_PAGE_SIZE = 10;

/**
 * The frozen backend requires at least one of courseId/studentUserId on the
 * enrollment list query (ENROLLMENT_QUERY_FILTER_REQUIRED otherwise), so
 * this feature only ever lists enrollments scoped to one student - which is
 * also the natural place for it in the UI (see the student detail page).
 * `status`, when given, is a real backend query param - never a client-side
 * filter over an already-fetched page.
 */
export function listEnrollmentsForStudent(
  api: ApiClient,
  tenantId: string,
  studentUserId: string,
  params: { limit: number; offset: number; status?: EnrollmentStatus },
): Promise<OffsetPage<InstructorEnrollmentSummary>> {
  const query = new URLSearchParams({
    studentUserId,
    limit: String(params.limit),
    offset: String(params.offset),
  });

  if (params.status) {
    query.set("status", params.status);
  }

  return api.request<OffsetPage<InstructorEnrollmentSummary>>(`/instructor/tenants/${tenantId}/enrollments?${query.toString()}`);
}

export function createEnrollment(api: ApiClient, tenantId: string, body: CreateEnrollmentRequest): Promise<EnrollmentSummary> {
  return api.request<EnrollmentSummary>(`/instructor/tenants/${tenantId}/enrollments`, {
    method: "POST",
    body,
  });
}

export function revokeEnrollment(api: ApiClient, tenantId: string, enrollmentId: string): Promise<EnrollmentSummary> {
  return api.request<EnrollmentSummary>(`/instructor/tenants/${tenantId}/enrollments/${enrollmentId}/revoke`, {
    method: "POST",
  });
}

/**
 * The frozen course list has no server-side search/filter - only bounded
 * offset pagination. This is used for the enrollment course selector, which
 * must present it as an explicit, controlled page-at-a-time picker (never
 * fetch every page, never imply the first page is the full course set).
 */
export function listCourses(api: ApiClient, tenantId: string, params: { limit: number; offset: number }): Promise<OffsetPage<CourseSummary>> {
  return api.request<OffsetPage<CourseSummary>>(`/instructor/tenants/${tenantId}/courses?limit=${params.limit}&offset=${params.offset}`);
}

export type EnrollmentsLoadState =
  | { status: "loading" }
  | { status: "ready"; data: OffsetPage<InstructorEnrollmentSummary> }
  | { status: "error"; error: unknown };

export function useStudentEnrollments(
  tenantId: string,
  studentUserId: string,
  offset: number,
  status: EnrollmentStatus | undefined,
): { state: EnrollmentsLoadState; retry: () => void } {
  const [state, setState] = useState<EnrollmentsLoadState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const key = `${tenantId}:${studentUserId}:${offset}:${status ?? "ALL"}:${attempt}`;
  const [trackedKey, setTrackedKey] = useState(key);

  if (trackedKey !== key) {
    setTrackedKey(key);
    setState({ status: "loading" });
  }

  useEffect(() => {
    let cancelled = false;

    listEnrollmentsForStudent(getAuthService().getClient(), tenantId, studentUserId, {
      limit: ENROLLMENTS_PAGE_SIZE,
      offset,
      status,
    })
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
  }, [tenantId, studentUserId, offset, status, attempt]);

  return { state, retry: () => setAttempt((value) => value + 1) };
}

export type CourseSelectorLoadState =
  | { status: "loading" }
  | { status: "ready"; data: OffsetPage<CourseSummary> }
  | { status: "error"; error: unknown };

export function useCourseSelectorPage(
  tenantId: string,
  offset: number,
  enabled: boolean,
): { state: CourseSelectorLoadState; retry: () => void } {
  const [state, setState] = useState<CourseSelectorLoadState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const key = `${tenantId}:${offset}:${enabled}:${attempt}`;
  const [trackedKey, setTrackedKey] = useState(key);

  if (trackedKey !== key) {
    setTrackedKey(key);
    setState({ status: "loading" });
  }

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let cancelled = false;

    listCourses(getAuthService().getClient(), tenantId, { limit: COURSE_SELECTOR_PAGE_SIZE, offset })
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
  }, [tenantId, offset, enabled, attempt]);

  return { state, retry: () => setAttempt((value) => value + 1) };
}
