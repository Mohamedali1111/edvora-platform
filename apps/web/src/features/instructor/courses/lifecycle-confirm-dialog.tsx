"use client";

import { useRef, useState } from "react";
import { getAuthService } from "@/lib/api/session";
import { useI18n } from "@/lib/i18n/i18n";
import type { TranslationKey } from "@/lib/i18n/translations";
import type { CourseSummary } from "@/lib/api/types";
import { Modal } from "@/features/instructor/students/dialog";
import { archiveCourse, publishCourse } from "./courses-service";
import { isCourseLifecycleConflict, isNetworkError, resolveErrorMessageKey } from "./error-mapping";
import { CourseReadinessSummary } from "./readiness-summary";

type LifecycleAction = "publish" | "archive";

const COPY: Record<LifecycleAction, { title: TranslationKey; body: TranslationKey; confirm: TranslationKey; pending: TranslationKey; errorFallback: TranslationKey }> = {
  publish: {
    title: "courses.publishDialogTitle",
    body: "courses.publishDialogCopy",
    confirm: "courses.publishConfirm",
    pending: "courses.publishing",
    errorFallback: "courses.publishErrorGeneric",
  },
  archive: {
    title: "courses.archiveDialogTitle",
    body: "courses.archiveDialogCopy",
    confirm: "courses.archiveConfirm",
    pending: "courses.archiving",
    errorFallback: "courses.archiveErrorGeneric",
  },
};

/**
 * Shared confirmation for both lifecycle-changing actions - the frozen
 * backend has no request body for either endpoint, so the only inputs are
 * which action and which course. Archive gets the danger styling since
 * ARCHIVED is terminal in V1 (no unpublish, no restore); publish is a
 * normal primary action, still confirmed because it's a meaningful,
 * effectively one-way step (there's no path back to DRAFT either).
 */
export function LifecycleConfirmDialog({
  action,
  tenantId,
  course,
  onClose,
  onDone,
  onConflict,
}: {
  action: LifecycleAction;
  tenantId: string;
  course: CourseSummary;
  onClose: () => void;
  onDone: (result: CourseSummary) => void;
  /**
   * Called (in addition to showing the error) when the action failed because the course's
   * lifecycle state changed since this page loaded - e.g. it was archived by another session
   * while this dialog was open. Callers should refetch so the page reflects real server state
   * instead of leaving stale Publish/Archive controls that would just fail again.
   */
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
        action === "publish" ? await publishCourse(client, tenantId, course.courseId) : await archiveCourse(client, tenantId, course.courseId);
      onDone(result);
    } catch (error) {
      if (isNetworkError(error)) {
        setBackendError(t("shell.apiUnavailable"));
      } else {
        setBackendError(t(resolveErrorMessageKey(error, copy.errorFallback)));

        if (isCourseLifecycleConflict(error)) {
          onConflict?.();
        }
      }
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <Modal titleId="course-lifecycle-title" onClose={onClose}>
      <div className="auth-form">
        <h2 id="course-lifecycle-title">{t(copy.title)}</h2>
        <p className="form-note">
          {t(copy.body)} <strong>{course.title}</strong>
        </p>

        {action === "publish" ? (
          <div className="lifecycle-readiness-summary">
            {/* This dialog mounts fresh every time it opens, so it has no
                tracked `contentVersion` of its own - `0` is fine, since
                mounting already fetches current data once and the dialog is
                too short-lived to accumulate further in-page staleness. */}
            <CourseReadinessSummary tenantId={tenantId} courseId={course.courseId} contentVersion={0} />
          </div>
        ) : null}

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
