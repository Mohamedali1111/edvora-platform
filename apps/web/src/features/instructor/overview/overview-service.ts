"use client";

import { useEffect, useState } from "react";
import type { ApiClient } from "../../../lib/api/client";
import { getAuthService } from "../../../lib/api/session";
import type { CourseSummary, NotificationsUnreadCount, OffsetPage, TenantStudentSummary } from "../../../lib/api/types";

/**
 * How many rows to preview per list. This is intentionally small: the
 * overview is a landing page, not the Students/Courses screens, and the
 * frozen API has no "total" field to size a bigger summary around anyway
 * (see OffsetPage in lib/api/types.ts).
 */
const PREVIEW_LIMIT = 5;

export type PreviewList<T> = {
  items: T[];
  /** True when the backend has more rows beyond this preview page. Never a count. */
  hasMore: boolean;
};

export type OverviewSnapshot = {
  /** null means this source failed to load; the rest of the overview still renders. */
  courses: PreviewList<CourseSummary> | null;
  students: PreviewList<TenantStudentSummary> | null;
  unreadNotifications: number | null;
};

/**
 * Loads a conservative set of overview sources in parallel and degrades
 * per-source: one failing endpoint (e.g. a transient 500 on /students)
 * never blocks the sources that did load. Never fetches an unbounded list -
 * only a small preview page of courses/students plus the real (non-paginated)
 * unread notification count.
 */
export async function fetchInstructorOverview(api: ApiClient, tenantId: string): Promise<OverviewSnapshot> {
  const [coursesResult, studentsResult, notificationsResult] = await Promise.allSettled([
    api.request<OffsetPage<CourseSummary>>(`/instructor/tenants/${tenantId}/courses?limit=${PREVIEW_LIMIT}`),
    api.request<OffsetPage<TenantStudentSummary>>(`/instructor/tenants/${tenantId}/students?limit=${PREVIEW_LIMIT}`),
    api.request<NotificationsUnreadCount>("/instructor/notifications/unread-count"),
  ]);

  return {
    courses:
      coursesResult.status === "fulfilled"
        ? { items: coursesResult.value.items, hasMore: coursesResult.value.hasMore }
        : null,
    students:
      studentsResult.status === "fulfilled"
        ? { items: studentsResult.value.items, hasMore: studentsResult.value.hasMore }
        : null,
    unreadNotifications: notificationsResult.status === "fulfilled" ? notificationsResult.value.unreadCount : null,
  };
}

export type OverviewLoadState = { status: "loading" } | { status: "ready"; data: OverviewSnapshot };

/**
 * Fetches the overview for a tenant, guarding against stale updates (e.g.
 * the component unmounts, or tenantId changes, before the request settles)
 * with the same cancelled-flag pattern the session bootstrap effect uses -
 * no AbortController plumbing needed for a one-shot read like this.
 */
export function useInstructorOverview(tenantId: string): { state: OverviewLoadState; retry: () => void } {
  const [state, setState] = useState<OverviewLoadState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [trackedKey, setTrackedKey] = useState(`${tenantId}:${attempt}`);

  // Reset to "loading" as soon as the tenant or a retry changes, during
  // render rather than inside the effect below (same pattern as
  // session-context.tsx - see react-hooks/set-state-in-effect).
  const currentKey = `${tenantId}:${attempt}`;
  if (trackedKey !== currentKey) {
    setTrackedKey(currentKey);
    setState({ status: "loading" });
  }

  useEffect(() => {
    let cancelled = false;

    fetchInstructorOverview(getAuthService().getClient(), tenantId).then((data) => {
      if (!cancelled) {
        setState({ status: "ready", data });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [tenantId, attempt]);

  return { state, retry: () => setAttempt((value) => value + 1) };
}
