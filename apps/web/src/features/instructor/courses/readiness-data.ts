"use client";

import { useEffect, useState } from "react";
import { getAuthService } from "../../../lib/api/session";
import type { CourseReadiness } from "../../../lib/api/types";
import { getCourseReadiness } from "./courses-service";

export type CourseReadinessLoadState =
  | { status: "loading" }
  | { status: "ready"; data: CourseReadiness }
  | { status: "error"; error: unknown };

/**
 * Thin fetch wrapper around `GET .../courses/:courseId/readiness` (DEC-0049) -
 * the server response is the single source of truth for course publish
 * readiness. This hook does no derivation of its own (contrast the prior
 * `useCourseReadiness`, which scanned Sections/Lessons/Media/Quiz list
 * endpoints itself and silently mis-resolved anything outside one paginated
 * Media page to "unknown" - see readiness-copy.ts and DEC-0049 for why that
 * approach was replaced).
 *
 * Fetches on mount, on `retry()` (a manual Refresh action), and whenever the
 * caller's own `contentVersion` changes - `course-detail.tsx` bumps that
 * after any in-page Chapter/Lesson create or lifecycle mutation, so
 * readiness tracks the one class of change most likely to make it stale
 * while the instructor is actually looking at this page. It does NOT poll
 * and does NOT know about a Quiz/Media edit made on a separate route -
 * those are covered by the same manual Refresh action, honestly labeled in
 * the UI, and by the fact that navigating back to this Course Detail route
 * remounts this hook and refetches automatically.
 */
export function useCourseReadiness(
  tenantId: string,
  courseId: string,
  contentVersion: number,
): { state: CourseReadinessLoadState; retry: () => void } {
  const [state, setState] = useState<CourseReadinessLoadState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const key = `${tenantId}:${courseId}:${contentVersion}:${attempt}`;
  const [trackedKey, setTrackedKey] = useState(key);

  if (trackedKey !== key) {
    setTrackedKey(key);
    setState({ status: "loading" });
  }

  useEffect(() => {
    let cancelled = false;

    getCourseReadiness(getAuthService().getClient(), tenantId, courseId)
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
  }, [tenantId, courseId, contentVersion, attempt]);

  return { state, retry: () => setAttempt((value) => value + 1) };
}
