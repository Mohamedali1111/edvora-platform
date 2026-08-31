"use client";

import { useEffect, useState } from "react";
import type { ApiClient } from "../../../lib/api/client";
import { getAuthService } from "../../../lib/api/session";
import type { AddStudentRequest, AddTenantStudentResult, OffsetPage, TenantStudentSummary } from "../../../lib/api/types";

/** Bounded page size for the students list - never fetched or aggregated beyond one page at a time. */
export const STUDENTS_PAGE_SIZE = 20;

export function listStudents(
  api: ApiClient,
  tenantId: string,
  params: { limit: number; offset: number },
): Promise<OffsetPage<TenantStudentSummary>> {
  return api.request<OffsetPage<TenantStudentSummary>>(
    `/instructor/tenants/${tenantId}/students?limit=${params.limit}&offset=${params.offset}`,
  );
}

export function getStudent(api: ApiClient, tenantId: string, studentUserId: string): Promise<TenantStudentSummary> {
  return api.request<TenantStudentSummary>(`/instructor/tenants/${tenantId}/students/${studentUserId}`);
}

export function addStudent(api: ApiClient, tenantId: string, body: AddStudentRequest): Promise<AddTenantStudentResult> {
  return api.request<AddTenantStudentResult>(`/instructor/tenants/${tenantId}/students`, {
    method: "POST",
    body,
  });
}

export type StudentsListLoadState =
  | { status: "loading" }
  | { status: "ready"; data: OffsetPage<TenantStudentSummary> }
  | { status: "error"; error: unknown };

/**
 * `tenantId` must always come from the authenticated instructor's tenant
 * context (useAuthenticatedInstructorSession), never from a route param -
 * a student id in the URL selects a resource, it never authorizes a tenant.
 */
export function useStudentsList(tenantId: string, offset: number): { state: StudentsListLoadState; retry: () => void } {
  const [state, setState] = useState<StudentsListLoadState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const key = `${tenantId}:${offset}:${attempt}`;
  const [trackedKey, setTrackedKey] = useState(key);

  if (trackedKey !== key) {
    setTrackedKey(key);
    setState({ status: "loading" });
  }

  useEffect(() => {
    let cancelled = false;

    listStudents(getAuthService().getClient(), tenantId, { limit: STUDENTS_PAGE_SIZE, offset })
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

export type StudentDetailLoadState =
  | { status: "loading" }
  | { status: "ready"; data: TenantStudentSummary }
  | { status: "error"; error: unknown };

export function useStudentDetail(
  tenantId: string,
  studentUserId: string,
): { state: StudentDetailLoadState; retry: () => void } {
  const [state, setState] = useState<StudentDetailLoadState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const key = `${tenantId}:${studentUserId}:${attempt}`;
  const [trackedKey, setTrackedKey] = useState(key);

  if (trackedKey !== key) {
    setTrackedKey(key);
    setState({ status: "loading" });
  }

  useEffect(() => {
    let cancelled = false;

    getStudent(getAuthService().getClient(), tenantId, studentUserId)
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
  }, [tenantId, studentUserId, attempt]);

  return { state, retry: () => setAttempt((value) => value + 1) };
}
