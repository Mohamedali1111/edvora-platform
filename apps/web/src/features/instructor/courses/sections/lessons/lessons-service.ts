"use client";

import { useEffect, useState } from "react";
import type { ApiClient } from "../../../../../lib/api/client";
import { getAuthService } from "../../../../../lib/api/session";
import type {
  CreateLessonRequest,
  DocumentAssetSummary,
  LessonListResponse,
  LessonSummary,
  LessonType,
  OffsetPage,
  QuizSummary,
  ReorderLessonsRequest,
  UpdateLessonRequest,
  VideoAssetSummary,
} from "../../../../../lib/api/types";

export function listLessons(api: ApiClient, tenantId: string, courseId: string, sectionId: string): Promise<LessonListResponse> {
  return api.request<LessonListResponse>(`/instructor/tenants/${tenantId}/courses/${courseId}/sections/${sectionId}/lessons`);
}

export function createLesson(
  api: ApiClient,
  tenantId: string,
  courseId: string,
  sectionId: string,
  body: CreateLessonRequest,
): Promise<LessonSummary> {
  return api.request<LessonSummary>(`/instructor/tenants/${tenantId}/courses/${courseId}/sections/${sectionId}/lessons`, {
    method: "POST",
    body,
  });
}

export function updateLesson(
  api: ApiClient,
  tenantId: string,
  courseId: string,
  sectionId: string,
  lessonId: string,
  body: UpdateLessonRequest,
): Promise<LessonSummary> {
  return api.request<LessonSummary>(
    `/instructor/tenants/${tenantId}/courses/${courseId}/sections/${sectionId}/lessons/${lessonId}`,
    { method: "PATCH", body },
  );
}

export function publishLesson(
  api: ApiClient,
  tenantId: string,
  courseId: string,
  sectionId: string,
  lessonId: string,
): Promise<LessonSummary> {
  return api.request<LessonSummary>(
    `/instructor/tenants/${tenantId}/courses/${courseId}/sections/${sectionId}/lessons/${lessonId}/publish`,
    { method: "POST" },
  );
}

export function archiveLesson(
  api: ApiClient,
  tenantId: string,
  courseId: string,
  sectionId: string,
  lessonId: string,
): Promise<LessonSummary> {
  return api.request<LessonSummary>(
    `/instructor/tenants/${tenantId}/courses/${courseId}/sections/${sectionId}/lessons/${lessonId}/archive`,
    { method: "POST" },
  );
}

/**
 * Scoped to one section (the frozen reorder endpoint lives under
 * .../sections/:sectionId/lessons/reorder). `lessonIds` must be exactly the
 * current non-ARCHIVED lesson set for that section, in the desired order -
 * see ordering.ts.
 */
export function reorderLessons(
  api: ApiClient,
  tenantId: string,
  courseId: string,
  sectionId: string,
  lessonIds: string[],
): Promise<LessonListResponse> {
  return api.request<LessonListResponse>(
    `/instructor/tenants/${tenantId}/courses/${courseId}/sections/${sectionId}/lessons/reorder`,
    { method: "POST", body: { lessonIds } satisfies ReorderLessonsRequest },
  );
}

/**
 * Real, already-existing, bounded content lists for the Create Lesson
 * content picker. This frontend never uploads/processes media or authors
 * quizzes - it only lets an instructor select from what already exists via
 * these frozen, paginated list endpoints (Media/Quiz slices own creation).
 */
export const CONTENT_PICKER_PAGE_SIZE = 10;

export function listVideoAssetsForSelection(
  api: ApiClient,
  tenantId: string,
  offset: number,
): Promise<OffsetPage<VideoAssetSummary>> {
  return api.request<OffsetPage<VideoAssetSummary>>(
    `/instructor/tenants/${tenantId}/media/videos?limit=${CONTENT_PICKER_PAGE_SIZE}&offset=${offset}`,
  );
}

export function listDocumentAssetsForSelection(
  api: ApiClient,
  tenantId: string,
  offset: number,
): Promise<OffsetPage<DocumentAssetSummary>> {
  return api.request<OffsetPage<DocumentAssetSummary>>(
    `/instructor/tenants/${tenantId}/media/documents?limit=${CONTENT_PICKER_PAGE_SIZE}&offset=${offset}`,
  );
}

export function listQuizzesForSelection(api: ApiClient, tenantId: string, offset: number): Promise<OffsetPage<QuizSummary>> {
  return api.request<OffsetPage<QuizSummary>>(`/instructor/tenants/${tenantId}/quizzes?limit=${CONTENT_PICKER_PAGE_SIZE}&offset=${offset}`);
}

export type LessonsListLoadState =
  | { status: "loading" }
  | { status: "ready"; data: LessonSummary[] }
  | { status: "error"; error: unknown };

/**
 * `tenantId` must always come from the authenticated instructor's tenant
 * context, never a route param. The list endpoint is unpaginated, same as
 * Sections - the frozen API always returns every lesson in the section in
 * one response.
 */
export function useLessonsList(
  tenantId: string,
  courseId: string,
  sectionId: string,
): { state: LessonsListLoadState; retry: () => void } {
  const [state, setState] = useState<LessonsListLoadState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const key = `${tenantId}:${courseId}:${sectionId}:${attempt}`;
  const [trackedKey, setTrackedKey] = useState(key);

  if (trackedKey !== key) {
    setTrackedKey(key);
    setState({ status: "loading" });
  }

  useEffect(() => {
    let cancelled = false;

    listLessons(getAuthService().getClient(), tenantId, courseId, sectionId)
      .then((response) => {
        if (!cancelled) {
          setState({ status: "ready", data: response.items });
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
  }, [tenantId, courseId, sectionId, attempt]);

  return { state, retry: () => setAttempt((value) => value + 1) };
}

export type ContentOptionItem = VideoAssetSummary | DocumentAssetSummary | QuizSummary;

export type ContentSelectionLoadState =
  | { status: "loading" }
  | { status: "ready"; data: OffsetPage<ContentOptionItem> }
  | { status: "error"; error: unknown };

/**
 * Backs the Create Lesson content picker. Only fetches an existing,
 * already-uploaded/authored resource list for the selected `type` - never
 * uploads, processes, or authors anything itself.
 */
export function useContentSelectionPage(
  tenantId: string,
  type: LessonType,
  offset: number,
): { state: ContentSelectionLoadState; retry: () => void } {
  const [state, setState] = useState<ContentSelectionLoadState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const key = `${tenantId}:${type}:${offset}:${attempt}`;
  const [trackedKey, setTrackedKey] = useState(key);

  if (trackedKey !== key) {
    setTrackedKey(key);
    setState({ status: "loading" });
  }

  useEffect(() => {
    let cancelled = false;
    const client = getAuthService().getClient();
    const request: Promise<OffsetPage<ContentOptionItem>> =
      type === "VIDEO"
        ? listVideoAssetsForSelection(client, tenantId, offset)
        : type === "DOCUMENT"
          ? listDocumentAssetsForSelection(client, tenantId, offset)
          : listQuizzesForSelection(client, tenantId, offset);

    request
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
  }, [tenantId, type, offset, attempt]);

  return { state, retry: () => setAttempt((value) => value + 1) };
}
