"use client";

import { useEffect, useState } from "react";
import type { ApiClient } from "@/lib/api/client";
import { getAuthService } from "@/lib/api/session";
import type { CreateInstructorRequest, CreatedInstructorResult, InstructorSummary, OffsetPage } from "@/lib/api/types";

/** Bounded page size - the frozen `/admin/instructors` list is only ever fetched one page at a time. */
export const INSTRUCTORS_PAGE_SIZE = 20;

/**
 * GET /admin/instructors (Platform Admin only). The frozen backend has no
 * status/search query param on `PaginationQueryDto`, only `limit`/`offset` -
 * so this is the entire real filtering contract; the frontend must never add
 * a client-only search/filter over one fetched page and present it as
 * complete.
 */
export function listInstructors(
  api: ApiClient,
  params: { limit: number; offset: number },
): Promise<OffsetPage<InstructorSummary>> {
  return api.request<OffsetPage<InstructorSummary>>(`/admin/instructors?limit=${params.limit}&offset=${params.offset}`);
}

/** GET /admin/instructors/:instructorId - `instructorId` is the Instructor's own userId. */
export function getInstructor(api: ApiClient, instructorId: string): Promise<InstructorSummary> {
  return api.request<InstructorSummary>(`/admin/instructors/${instructorId}`);
}

/**
 * POST /admin/instructors - creates the Instructor account and its owned
 * Tenant/Academy together as one onboarding operation (201 Created). Always
 * returns a fresh one-time `activation` (see CreatedInstructorResult) -
 * there is no "existing account" branch on this endpoint, unlike student
 * add.
 */
export function createInstructor(api: ApiClient, body: CreateInstructorRequest): Promise<CreatedInstructorResult> {
  return api.request<CreatedInstructorResult>("/admin/instructors", {
    method: "POST",
    body,
  });
}

export type InstructorsListLoadState =
  | { status: "loading" }
  | { status: "ready"; data: OffsetPage<InstructorSummary> }
  | { status: "error"; error: unknown };

export function useInstructorsList(offset: number): { state: InstructorsListLoadState; retry: () => void } {
  const [state, setState] = useState<InstructorsListLoadState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const key = `${offset}:${attempt}`;
  const [trackedKey, setTrackedKey] = useState(key);

  if (trackedKey !== key) {
    setTrackedKey(key);
    setState({ status: "loading" });
  }

  useEffect(() => {
    let cancelled = false;

    listInstructors(getAuthService().getClient(), { limit: INSTRUCTORS_PAGE_SIZE, offset })
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
  }, [offset, attempt]);

  return { state, retry: () => setAttempt((value) => value + 1) };
}

export type InstructorDetailLoadState =
  | { status: "loading" }
  | { status: "ready"; data: InstructorSummary }
  | { status: "error"; error: unknown };

export function useInstructorDetail(instructorId: string): { state: InstructorDetailLoadState; retry: () => void } {
  const [state, setState] = useState<InstructorDetailLoadState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const key = `${instructorId}:${attempt}`;
  const [trackedKey, setTrackedKey] = useState(key);

  if (trackedKey !== key) {
    setTrackedKey(key);
    setState({ status: "loading" });
  }

  useEffect(() => {
    let cancelled = false;

    getInstructor(getAuthService().getClient(), instructorId)
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
  }, [instructorId, attempt]);

  return { state, retry: () => setAttempt((value) => value + 1) };
}
