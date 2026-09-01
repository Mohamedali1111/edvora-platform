"use client";

import { useEffect, useState } from "react";
import type { ApiClient } from "../../../lib/api/client";
import { getAuthService } from "../../../lib/api/session";
import type { NotificationSummary, OffsetPage } from "../../../lib/api/types";

/** Bounded page size for the inbox - never fetched or aggregated beyond one page at a time. */
export const NOTIFICATIONS_PAGE_SIZE = 20;

/**
 * GET /instructor/notifications - the frozen Slice H inbox endpoint. Not
 * tenant-scoped in the URL (the route is `instructor/notifications`, no
 * `:tenantId` segment) - the backend derives the recipient exclusively from
 * the authenticated principal, so there is no tenant/URL/query parameter
 * for this feature to get wrong. `limit`/`offset` are the only supported
 * query params; the frozen contract has no unread-only or type filter.
 */
export function listNotifications(api: ApiClient, params: { limit: number; offset: number }): Promise<OffsetPage<NotificationSummary>> {
  return api.request<OffsetPage<NotificationSummary>>(`/instructor/notifications?limit=${params.limit}&offset=${params.offset}`);
}

/**
 * PATCH /instructor/notifications/:notificationId/read - the frozen
 * mark-read endpoint. Sends no body (there is nothing for the client to
 * supply: `readAt` is always server-set, once, from `ClockService.now()`).
 * The backend's `WHERE readAt IS NULL` update makes this naturally
 * idempotent - calling it again on an already-read notification is a safe
 * no-op that still returns the row with its original `readAt` preserved,
 * so the frontend never needs to guess or protect against a second call.
 */
export function markNotificationRead(api: ApiClient, notificationId: string): Promise<NotificationSummary> {
  return api.request<NotificationSummary>(`/instructor/notifications/${notificationId}/read`, { method: "PATCH" });
}

export type NotificationsListState =
  | { status: "loading" }
  | { status: "ready"; data: OffsetPage<NotificationSummary> }
  | { status: "error"; error: unknown };

/**
 * Same reset-during-render + `cancelled`-flag pattern every other list hook
 * in this app uses (see `useStudentsList`) - changing the page always
 * starts a fresh request, and any in-flight response for a since-
 * superseded offset is discarded rather than applied.
 */
export function useNotificationsList(offset: number): { state: NotificationsListState; retry: () => void } {
  const [state, setState] = useState<NotificationsListState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const key = `${offset}:${attempt}`;
  const [trackedKey, setTrackedKey] = useState(key);

  if (trackedKey !== key) {
    setTrackedKey(key);
    setState({ status: "loading" });
  }

  useEffect(() => {
    let cancelled = false;

    listNotifications(getAuthService().getClient(), { limit: NOTIFICATIONS_PAGE_SIZE, offset })
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
