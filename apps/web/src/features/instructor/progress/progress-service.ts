"use client";

import { useEffect, useState } from "react";
import type { ApiClient } from "../../../lib/api/client";
import { getAuthService } from "../../../lib/api/session";
import type {
  CourseProgressRow,
  CourseSummary,
  EnrollmentStatus,
  InstructorQuizAttemptSummary,
  OffsetPage,
  QuizSummary,
  TenantStudentSummary,
} from "../../../lib/api/types";
import { listCourses } from "../courses/courses-service";
import { listQuizzes } from "../quizzes/quizzes-service";
import { listStudents } from "../students/students-service";

/** Bounded page sizes - every list on this page is fetched and rendered one page at a time, never aggregated. */
export const PROGRESS_PAGE_SIZE = 20;
export const QUIZ_RESULTS_PAGE_SIZE = 20;
export const ENTITY_PICKER_PAGE_SIZE = 10;

/**
 * GET /instructor/tenants/:tenantId/courses/:courseId/progress - the frozen
 * Slice G reporting endpoint. `status`, when given, is a real backend query
 * param (an `EnrollmentStatus` value) - never a client-side filter applied
 * after the fact. Response is passed through untouched: no total is added,
 * no field is recomputed.
 */
export function listCourseProgress(
  api: ApiClient,
  tenantId: string,
  courseId: string,
  params: { status?: EnrollmentStatus; limit: number; offset: number },
): Promise<OffsetPage<CourseProgressRow>> {
  const query = new URLSearchParams({ limit: String(params.limit), offset: String(params.offset) });

  if (params.status) {
    query.set("status", params.status);
  }

  return api.request<OffsetPage<CourseProgressRow>>(`/instructor/tenants/${tenantId}/courses/${courseId}/progress?${query.toString()}`);
}

/**
 * GET /instructor/tenants/:tenantId/quizzes/:quizId/attempts - the frozen
 * Slice G reporting endpoint. `studentUserId`/`passed`, when given, are real
 * backend query params. Every score/percentage/passed value on the returned
 * rows is the backend's own historical snapshot - this function (and every
 * caller) must never derive `passed` from a Quiz's current metadata.
 */
export function listQuizAttempts(
  api: ApiClient,
  tenantId: string,
  quizId: string,
  params: { studentUserId?: string; passed?: boolean; limit: number; offset: number },
): Promise<OffsetPage<InstructorQuizAttemptSummary>> {
  const query = new URLSearchParams({ limit: String(params.limit), offset: String(params.offset) });

  if (params.studentUserId) {
    query.set("studentUserId", params.studentUserId);
  }

  if (params.passed !== undefined) {
    query.set("passed", String(params.passed));
  }

  return api.request<OffsetPage<InstructorQuizAttemptSummary>>(`/instructor/tenants/${tenantId}/quizzes/${quizId}/attempts?${query.toString()}`);
}

export type CourseProgressLoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; data: OffsetPage<CourseProgressRow> }
  | { status: "error"; error: unknown };

/**
 * `courseId` is `null` until the instructor picks a course from the bounded
 * course selector - the report is never fetched (and no "loading" state is
 * shown) until then. Keyed by every input that affects the request
 * (including `status`/`offset`), the same reset-during-render + `cancelled`
 * flag pattern every other list hook in this app uses (see
 * `useStudentsList`) - changing the course, the status filter, or the page
 * always starts a fresh request and any in-flight response for a since-
 * superseded key is discarded rather than applied.
 */
export function useCourseProgress(
  tenantId: string,
  courseId: string | null,
  status: EnrollmentStatus | undefined,
  offset: number,
): { state: CourseProgressLoadState; retry: () => void } {
  const [state, setState] = useState<CourseProgressLoadState>(courseId ? { status: "loading" } : { status: "idle" });
  const [attempt, setAttempt] = useState(0);
  const key = `${tenantId}:${courseId ?? ""}:${status ?? "ALL"}:${offset}:${attempt}`;
  const [trackedKey, setTrackedKey] = useState(key);

  if (trackedKey !== key) {
    setTrackedKey(key);
    setState(courseId ? { status: "loading" } : { status: "idle" });
  }

  useEffect(() => {
    if (!courseId) {
      return;
    }

    let cancelled = false;

    listCourseProgress(getAuthService().getClient(), tenantId, courseId, { status, limit: PROGRESS_PAGE_SIZE, offset })
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
  }, [tenantId, courseId, status, offset, attempt]);

  return { state, retry: () => setAttempt((value) => value + 1) };
}

export type QuizAttemptsLoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; data: OffsetPage<InstructorQuizAttemptSummary> }
  | { status: "error"; error: unknown };

/** Same idle-until-selected / reset-on-key-change shape as `useCourseProgress`, scoped to one Quiz's attempts. */
export function useQuizAttempts(
  tenantId: string,
  quizId: string | null,
  studentUserId: string | undefined,
  passed: boolean | undefined,
  offset: number,
): { state: QuizAttemptsLoadState; retry: () => void } {
  const [state, setState] = useState<QuizAttemptsLoadState>(quizId ? { status: "loading" } : { status: "idle" });
  const [attempt, setAttempt] = useState(0);
  const key = `${tenantId}:${quizId ?? ""}:${studentUserId ?? ""}:${passed ?? "ALL"}:${offset}:${attempt}`;
  const [trackedKey, setTrackedKey] = useState(key);

  if (trackedKey !== key) {
    setTrackedKey(key);
    setState(quizId ? { status: "loading" } : { status: "idle" });
  }

  useEffect(() => {
    if (!quizId) {
      return;
    }

    let cancelled = false;

    listQuizAttempts(getAuthService().getClient(), tenantId, quizId, { studentUserId, passed, limit: QUIZ_RESULTS_PAGE_SIZE, offset })
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
  }, [tenantId, quizId, studentUserId, passed, offset, attempt]);

  return { state, retry: () => setAttempt((value) => value + 1) };
}

export type EntityPickerLoadState<T> =
  | { status: "loading" }
  | { status: "ready"; data: OffsetPage<T> }
  | { status: "error"; error: unknown };

/**
 * Bounded, page-at-a-time course picker for the Progress tab - reuses the
 * exact `listCourses` call the Courses feature already makes; never fetches
 * more than one page, and never assumes the first page is the complete
 * Course set (see `useCourseSelectorPage` in enrollments-service.ts for the
 * prior art this mirrors). Only fetches while `enabled` (the picker is open).
 */
export function useCoursePicker(tenantId: string, offset: number, enabled: boolean): { state: EntityPickerLoadState<CourseSummary>; retry: () => void } {
  const [state, setState] = useState<EntityPickerLoadState<CourseSummary>>({ status: "loading" });
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

    listCourses(getAuthService().getClient(), tenantId, { limit: ENTITY_PICKER_PAGE_SIZE, offset })
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

/** Bounded, page-at-a-time quiz picker for the Quiz Results tab - same shape/guarantees as `useCoursePicker`. */
export function useQuizPicker(tenantId: string, offset: number, enabled: boolean): { state: EntityPickerLoadState<QuizSummary>; retry: () => void } {
  const [state, setState] = useState<EntityPickerLoadState<QuizSummary>>({ status: "loading" });
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

    listQuizzes(getAuthService().getClient(), tenantId, { limit: ENTITY_PICKER_PAGE_SIZE, offset })
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

/** Bounded, page-at-a-time student picker for the optional Quiz Results student filter - same shape/guarantees as `useCoursePicker`. */
export function useStudentPicker(tenantId: string, offset: number, enabled: boolean): { state: EntityPickerLoadState<TenantStudentSummary>; retry: () => void } {
  const [state, setState] = useState<EntityPickerLoadState<TenantStudentSummary>>({ status: "loading" });
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

    listStudents(getAuthService().getClient(), tenantId, { limit: ENTITY_PICKER_PAGE_SIZE, offset })
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
