"use client";

import { useRef, useState } from "react";
import { getAuthService } from "@/lib/api/session";
import { useI18n } from "@/lib/i18n/i18n";
import type { TranslationKey } from "@/lib/i18n/translations";
import type { LessonSummary } from "@/lib/api/types";
import { LifecycleActionDialog, type LifecycleActionCopy } from "@/features/instructor/lifecycle-action-dialog";
import { archiveLesson, publishLesson, restoreLesson, unpublishLesson } from "./lessons-service";
import { isLessonLifecycleConflict, isNetworkError, resolveErrorMessageKey } from "./error-mapping";

export type LessonLifecycleAction = "publish" | "takeOffline" | "archive" | "restore";

const COPY: Record<LessonLifecycleAction, LifecycleActionCopy> = {
  publish: {
    title: "lessons.publishDialogTitle",
    body: "lessons.publishDialogCopy",
    confirm: "lessons.publishConfirm",
    pending: "courses.publishing",
  },
  takeOffline: {
    title: "lessons.takeOfflineDialogTitle",
    body: "lessons.takeOfflineDialogCopy",
    confirm: "lessons.takeOfflineConfirm",
    pending: "courses.takingOffline",
  },
  archive: {
    title: "lessons.archiveDialogTitle",
    body: "lessons.archiveDialogCopy",
    confirm: "lessons.archiveConfirm",
    pending: "courses.archiving",
  },
  restore: {
    title: "lessons.restoreDialogTitle",
    body: "lessons.restoreDialogCopy",
    confirm: "lessons.restoreConfirm",
    pending: "courses.restoring",
  },
};

const ERROR_FALLBACK: Record<LessonLifecycleAction, TranslationKey> = {
  publish: "lessons.publishErrorGeneric",
  takeOffline: "lessons.takeOfflineErrorGeneric",
  archive: "lessons.archiveErrorGeneric",
  restore: "lessons.restoreErrorGeneric",
};

/**
 * Mirrors Course/Section's LifecycleConfirmDialog (same shared shell, same
 * four actions). The backend has no request body for any of these four
 * endpoints. Publish failures here are where LESSON_CONTENT_NOT_READY
 * actually surfaces (the asset/quiz readiness check happens only at publish
 * time, never predicted beforehand) - resolveErrorMessageKey maps it to a
 * clear, translated, accurate explanation rather than a raw backend string.
 */
export function LessonLifecycleConfirmDialog({
  action,
  tenantId,
  courseId,
  sectionId,
  lesson,
  onClose,
  onDone,
  onConflict,
}: {
  action: LessonLifecycleAction;
  tenantId: string;
  courseId: string;
  sectionId: string;
  lesson: LessonSummary;
  onClose: () => void;
  onDone: (result: LessonSummary) => void;
  onConflict?: () => void;
}) {
  const { t } = useI18n();
  const [backendError, setBackendError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const copy = COPY[action];

  async function confirm() {
    if (submittingRef.current) {
      return;
    }

    setBackendError(null);
    submittingRef.current = true;
    setSubmitting(true);

    try {
      const client = getAuthService().getClient();
      const result =
        action === "publish"
          ? await publishLesson(client, tenantId, courseId, sectionId, lesson.lessonId)
          : action === "takeOffline"
            ? await unpublishLesson(client, tenantId, courseId, sectionId, lesson.lessonId)
            : action === "archive"
              ? await archiveLesson(client, tenantId, courseId, sectionId, lesson.lessonId)
              : await restoreLesson(client, tenantId, courseId, sectionId, lesson.lessonId);
      onDone(result);
    } catch (error) {
      if (isNetworkError(error)) {
        setBackendError(t("shell.apiUnavailable"));
      } else {
        setBackendError(t(resolveErrorMessageKey(error, ERROR_FALLBACK[action])));

        if (isLessonLifecycleConflict(error)) {
          onConflict?.();
        }
      }
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <LifecycleActionDialog
      titleId="lesson-lifecycle-title"
      entityTitle={lesson.title}
      copy={copy}
      danger={action === "archive"}
      backendError={backendError}
      submitting={submitting}
      onConfirm={confirm}
      onClose={onClose}
    />
  );
}
