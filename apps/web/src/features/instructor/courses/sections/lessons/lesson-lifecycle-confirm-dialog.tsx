"use client";

import { useRef, useState } from "react";
import { Modal } from "@/features/instructor/students/dialog";
import { getAuthService } from "@/lib/api/session";
import { useI18n } from "@/lib/i18n/i18n";
import type { TranslationKey } from "@/lib/i18n/translations";
import type { LessonSummary } from "@/lib/api/types";
import { archiveLesson, publishLesson } from "./lessons-service";
import { isLessonLifecycleConflict, isNetworkError, resolveErrorMessageKey } from "./error-mapping";

type LifecycleAction = "publish" | "archive";

const COPY: Record<
  LifecycleAction,
  { title: TranslationKey; body: TranslationKey; confirm: TranslationKey; pending: TranslationKey; errorFallback: TranslationKey }
> = {
  publish: {
    title: "lessons.publishDialogTitle",
    body: "lessons.publishDialogCopy",
    confirm: "lessons.publishConfirm",
    pending: "courses.publishing",
    errorFallback: "lessons.publishErrorGeneric",
  },
  archive: {
    title: "lessons.archiveDialogTitle",
    body: "lessons.archiveDialogCopy",
    confirm: "lessons.archiveConfirm",
    pending: "courses.archiving",
    errorFallback: "lessons.archiveErrorGeneric",
  },
};

/**
 * Mirrors Course/Section's LifecycleConfirmDialog (same shape/behavior),
 * kept as its own component rather than generalizing the already-committed
 * ones. The frozen backend has no request body for either endpoint. Publish
 * failures here are where LESSON_CONTENT_NOT_READY actually surfaces (the
 * asset/quiz readiness check happens only at publish time, never predicted
 * beforehand) - resolveErrorMessageKey maps it to a clear, translated,
 * accurate explanation rather than a raw backend string.
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
  action: LifecycleAction;
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
          : await archiveLesson(client, tenantId, courseId, sectionId, lesson.lessonId);
      onDone(result);
    } catch (error) {
      if (isNetworkError(error)) {
        setBackendError(t("shell.apiUnavailable"));
      } else {
        setBackendError(t(resolveErrorMessageKey(error, copy.errorFallback)));

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
    <Modal titleId="lesson-lifecycle-title" onClose={onClose}>
      <div className="auth-form">
        <h2 id="lesson-lifecycle-title">{t(copy.title)}</h2>
        <p className="form-note">
          {t(copy.body)} <strong>{lesson.title}</strong>
        </p>

        {backendError ? (
          <div className="form-error" role="alert">
            {backendError}
          </div>
        ) : null}

        <div className="modal-actions">
          <button className="secondary-button" type="button" onClick={onClose} disabled={submitting} autoFocus>
            {t("common.cancel")}
          </button>
          <button
            className={action === "archive" ? "primary-button danger-button" : "primary-button"}
            type="button"
            onClick={confirm}
            disabled={submitting}
          >
            {submitting ? t(copy.pending) : t(copy.confirm)}
          </button>
        </div>
      </div>
    </Modal>
  );
}
