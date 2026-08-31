"use client";

import { useEffect, useRef, useState } from "react";
import type { ApiClient } from "../../../lib/api/client";
import { getAuthService } from "../../../lib/api/session";
import type {
  CreateDocumentUploadIntentRequest,
  CreateVideoUploadIntentRequest,
  DocumentAssetSummary,
  DocumentUploadConfirmation,
  DocumentUploadIntent,
  OffsetPage,
  VideoAssetSummary,
  VideoUploadIntent,
} from "../../../lib/api/types";

/**
 * Bounded page size for both Documents and Videos lists - never fetched or
 * aggregated beyond one page at a time. Matches the same
 * `{items, limit, offset, hasMore}` contract, `previousOffset`/`nextOffset`/
 * `canGoPrevious`/`canGoNext` pagination helpers, and page size convention
 * the Lesson content picker already uses for these exact endpoints (see
 * courses/sections/lessons/lessons-service.ts) - Media Management and the
 * Lesson picker independently call the same frozen list endpoints rather
 * than sharing one function, since the Lesson picker's own file is treated
 * as stable/unmodified in this slice.
 */
export const MEDIA_PAGE_SIZE = 20;

export function listDocuments(api: ApiClient, tenantId: string, offset: number): Promise<OffsetPage<DocumentAssetSummary>> {
  return api.request<OffsetPage<DocumentAssetSummary>>(
    `/instructor/tenants/${tenantId}/media/documents?limit=${MEDIA_PAGE_SIZE}&offset=${offset}`,
  );
}

export function listVideos(api: ApiClient, tenantId: string, offset: number): Promise<OffsetPage<VideoAssetSummary>> {
  return api.request<OffsetPage<VideoAssetSummary>>(
    `/instructor/tenants/${tenantId}/media/videos?limit=${MEDIA_PAGE_SIZE}&offset=${offset}`,
  );
}

export function createDocumentUploadIntent(
  api: ApiClient,
  tenantId: string,
  body: CreateDocumentUploadIntentRequest,
): Promise<DocumentUploadIntent> {
  return api.request<DocumentUploadIntent>(`/instructor/tenants/${tenantId}/media/documents/upload-intents`, {
    method: "POST",
    body,
  });
}

export function createVideoUploadIntent(
  api: ApiClient,
  tenantId: string,
  body: CreateVideoUploadIntentRequest,
): Promise<VideoUploadIntent> {
  return api.request<VideoUploadIntent>(`/instructor/tenants/${tenantId}/media/videos/upload-intents`, {
    method: "POST",
    body,
  });
}

/**
 * No request body - the backend re-derives everything (temporary object
 * key, declared size/MIME) from the `documentAssetId`'s own `UPLOADING` row.
 * Idempotent for an already-`READY` asset, so this is also the correct
 * "retry" call after a transient failure here (see docs/MEDIA.md).
 */
export function confirmDocumentUpload(api: ApiClient, tenantId: string, documentAssetId: string): Promise<DocumentUploadConfirmation> {
  return api.request<DocumentUploadConfirmation>(
    `/instructor/tenants/${tenantId}/media/documents/${documentAssetId}/confirm-upload`,
    { method: "POST" },
  );
}

export type DocumentsListLoadState =
  | { status: "loading" }
  | { status: "ready"; data: OffsetPage<DocumentAssetSummary> }
  | { status: "error"; error: unknown };

/** `tenantId` always comes from the authenticated instructor's tenant context, never a route param. */
export function useDocumentsList(tenantId: string, offset: number): { state: DocumentsListLoadState; retry: () => void } {
  const [state, setState] = useState<DocumentsListLoadState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const key = `${tenantId}:${offset}:${attempt}`;
  const [trackedKey, setTrackedKey] = useState(key);

  if (trackedKey !== key) {
    setTrackedKey(key);
    setState({ status: "loading" });
  }

  useEffect(() => {
    let cancelled = false;

    listDocuments(getAuthService().getClient(), tenantId, offset)
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

export type VideosListLoadState =
  | { status: "loading" }
  | { status: "ready"; data: OffsetPage<VideoAssetSummary> }
  | { status: "error"; error: unknown };

/**
 * Same shape/contract as `useDocumentsList`, plus `refresh()`: a silent
 * background re-fetch of the same page that never flips `state` back to
 * `"loading"` (it only replaces `state` on a successful response, and is a
 * best-effort no-op on failure - the already-rendered page simply stays as
 * it was). `retry()` is for user-initiated actions (the error state's "Try
 * again", or an offset change) where showing a loading state is expected;
 * `refresh()` is what `VideosPanel` calls on its bounded polling interval
 * (`shouldPollVideos`/`VIDEO_POLL_INTERVAL_MS`, polling.ts) and from its
 * explicit Refresh button, so neither ever blanks out an already-populated
 * table while a Bunny webhook's eventual READY/FAILED update is awaited.
 */
export function useVideosList(
  tenantId: string,
  offset: number,
): { state: VideosListLoadState; retry: () => void; refresh: () => void } {
  const [state, setState] = useState<VideosListLoadState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const key = `${tenantId}:${offset}:${attempt}`;
  const [trackedKey, setTrackedKey] = useState(key);
  // Lets a stray in-flight `refresh()` (see below) recognize it has become
  // stale - e.g. the instructor changed pages, or this component unmounted -
  // and discard its result instead of calling `setState` for the wrong
  // page or after unmount.
  const currentKeyRef = useRef(key);
  const mountedRef = useRef(true);

  if (trackedKey !== key) {
    setTrackedKey(key);
    setState({ status: "loading" });
  }

  useEffect(() => {
    let cancelled = false;

    listVideos(getAuthService().getClient(), tenantId, offset)
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

  // Keeps `currentKeyRef`/`mountedRef` in sync for `refresh()` below - done
  // in effects (not during render) per the rules of hooks. Two separate
  // effects deliberately: the mounted flag must only flip on true unmount,
  // not on every key change (a plain offset/tenantId change is not
  // "unmounted", and re-declaring one combined effect's cleanup would fire
  // on every key change too).
  useEffect(() => {
    currentKeyRef.current = key;
  }, [key]);

  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  return {
    state,
    retry: () => setAttempt((value) => value + 1),
    refresh: () => {
      const requestedForKey = key;

      listVideos(getAuthService().getClient(), tenantId, offset)
        .then((data) => {
          if (mountedRef.current && currentKeyRef.current === requestedForKey) {
            setState({ status: "ready", data });
          }
        })
        .catch(() => undefined);
    },
  };
}
