"use client";

import { useEffect, useState } from "react";
import type { ApiClient } from "@/lib/api/client";
import { getAuthService } from "@/lib/api/session";
import type { DeviceChangeRequestSummary, OffsetPage } from "@/lib/api/types";

/** Bounded page size - the frozen `/admin/device-change-requests` list is only ever fetched one page at a time. */
export const DEVICE_REQUESTS_PAGE_SIZE = 20;

/**
 * GET /admin/device-change-requests (Platform Admin only). The frozen
 * backend hard-codes this to `status: PENDING` - there is no status/search
 * query param on `DeviceListQueryDto`, only `limit`/`offset` - so this is
 * the entire real filtering contract; the frontend must never add a
 * client-only search/filter over one fetched page and present it as
 * complete.
 */
export function listPendingDeviceChangeRequests(
  api: ApiClient,
  params: { limit: number; offset: number },
): Promise<OffsetPage<DeviceChangeRequestSummary>> {
  return api.request<OffsetPage<DeviceChangeRequestSummary>>(
    `/admin/device-change-requests?limit=${params.limit}&offset=${params.offset}`,
  );
}

/**
 * POST /admin/device-change-requests/:id/approve - 204 No Content on
 * success. `reviewNote` is optional; an empty object is sent when omitted
 * (JSON.stringify drops an `undefined` property), matching
 * `ReviewDeviceChangeDto`'s optional field.
 */
export function approveDeviceChangeRequest(api: ApiClient, requestId: string, reviewNote: string | undefined): Promise<void> {
  return api.request<void>(`/admin/device-change-requests/${requestId}/approve`, {
    method: "POST",
    body: { reviewNote },
  });
}

/** POST /admin/device-change-requests/:id/reject - 204 No Content on success. */
export function rejectDeviceChangeRequest(api: ApiClient, requestId: string, reviewNote: string | undefined): Promise<void> {
  return api.request<void>(`/admin/device-change-requests/${requestId}/reject`, {
    method: "POST",
    body: { reviewNote },
  });
}

export type DeviceRequestsLoadState =
  | { status: "loading" }
  | { status: "ready"; data: OffsetPage<DeviceChangeRequestSummary> }
  | { status: "error"; error: unknown };

export function useDeviceChangeRequests(offset: number): { state: DeviceRequestsLoadState; retry: () => void } {
  const [state, setState] = useState<DeviceRequestsLoadState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const key = `${offset}:${attempt}`;
  const [trackedKey, setTrackedKey] = useState(key);

  if (trackedKey !== key) {
    setTrackedKey(key);
    setState({ status: "loading" });
  }

  useEffect(() => {
    let cancelled = false;

    listPendingDeviceChangeRequests(getAuthService().getClient(), { limit: DEVICE_REQUESTS_PAGE_SIZE, offset })
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
