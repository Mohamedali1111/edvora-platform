"use client";

import { useRef, useState } from "react";
import { getAuthService } from "@/lib/api/session";
import { useI18n } from "@/lib/i18n/i18n";
import type { TranslationKey } from "@/lib/i18n/translations";
import type { CourseSummary } from "@/lib/api/types";
import { LifecycleActionDialog, type LifecycleActionCopy } from "@/features/instructor/lifecycle-action-dialog";
import { archiveCourse, publishCourse, restoreCourse, unpublishCourse } from "./courses-service";
import { isCourseLifecycleConflict, isNetworkError, resolveErrorMessageKey } from "./error-mapping";
import { CourseReadinessSummary } from "./readiness-summary";

export type CourseLifecycleAction = "publish" | "takeOffline" | "archive" | "restore";

const COPY: Record<CourseLifecycleAction, LifecycleActionCopy> = {
  publish: {
    title: "courses.publishDialogTitle",
    body: "courses.publishDialogCopy",
    confirm: "courses.publishConfirm",
    pending: "courses.publishing",
  },
  takeOffline: {
    title: "courses.takeOfflineDialogTitle",
    body: "courses.takeOfflineDialogCopy",
    confirm: "courses.takeOfflineConfirm",
    pending: "courses.takingOffline",
  },
  archive: {
    title: "courses.archiveDialogTitle",
    body: "courses.archiveDialogCopy",
    confirm: "courses.archiveConfirm",
    pending: "courses.archiving",
  },
  restore: {
    title: "courses.restoreDialogTitle",
    body: "courses.restoreDialogCopy",
    confirm: "courses.restoreConfirm",
    pending: "courses.restoring",
  },
};

const ERROR_FALLBACK: Record<CourseLifecycleAction, TranslationKey> = {
  publish: "courses.publishErrorGeneric",
  takeOffline: "courses.takeOfflineErrorGeneric",
  archive: "courses.archiveErrorGeneric",
  restore: "courses.restoreErrorGeneric",
};

/**
 * Shared confirmation for all four Course lifecycle-changing actions - the
 * backend has no request body for any of them, so the only inputs are which
 * action and which course. Archive gets the danger styling since it's the
 * only action that removes the Course from normal active use; Take Offline
 * and Restore both land the Course back on DRAFT and are otherwise ordinary,
 * reversible actions like Publish.
 */
export function LifecycleConfirmDialog({
  action,
  tenantId,
  course,
  onClose,
  onDone,
  onConflict,
}: {
  action: CourseLifecycleAction;
  tenantId: string;
  course: CourseSummary;
  onClose: () => void;
  onDone: (result: CourseSummary) => void;
  /**
   * Called (in addition to showing the error) when the action failed because the course's
   * lifecycle state changed since this page loaded - e.g. it was archived by another session
   * while this dialog was open. Callers should refetch so the page reflects real server state
   * instead of leaving stale controls that would just fail again.
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
        action === "publish"
          ? await publishCourse(client, tenantId, course.courseId)
          : action === "takeOffline"
            ? await unpublishCourse(client, tenantId, course.courseId)
            : action === "archive"
              ? await archiveCourse(client, tenantId, course.courseId)
              : await restoreCourse(client, tenantId, course.courseId);
      onDone(result);
    } catch (error) {
      if (isNetworkError(error)) {
        setBackendError(t("shell.apiUnavailable"));
      } else {
        setBackendError(t(resolveErrorMessageKey(error, ERROR_FALLBACK[action])));

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
    <LifecycleActionDialog
      titleId="course-lifecycle-title"
      entityTitle={course.title}
      copy={copy}
      danger={action === "archive"}
      backendError={backendError}
      submitting={submitting}
      onConfirm={confirm}
      onClose={onClose}
    >
      {action === "publish" ? (
        <div className="lifecycle-readiness-summary">
          {/* This dialog mounts fresh every time it opens, so it has no
              tracked `contentVersion` of its own - `0` is fine, since
              mounting already fetches current data once and the dialog is
              too short-lived to accumulate further in-page staleness. */}
          <CourseReadinessSummary tenantId={tenantId} courseId={course.courseId} contentVersion={0} />
        </div>
      ) : null}
    </LifecycleActionDialog>
  );
}
