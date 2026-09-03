"use client";

import { useRef, useState } from "react";
import { getAuthService } from "@/lib/api/session";
import { useI18n } from "@/lib/i18n/i18n";
import type { TranslationKey } from "@/lib/i18n/translations";
import type { CourseSummary } from "@/lib/api/types";
import { LifecycleActionDialog, type LifecycleActionCopy } from "@/features/instructor/lifecycle-action-dialog";
import { archiveCourse, publishCourse, restoreCourse, unpublishCourse } from "./courses-service";
import { isCourseLifecycleConflict, isNetworkError, resolveErrorMessageKey } from "./error-mapping";

export type CourseLifecycleAction = "publish" | "takeOffline" | "archive" | "restore";

const COPY: Record<CourseLifecycleAction, LifecycleActionCopy> = {
  // Reachable only for a Draft Course that has been live before ("Make live
  // again" - see first-publish.ts's resolveCourseHeaderPrimaryAction). A
  // never-published Draft Course never opens this dialog for "publish" at
  // all - its "Review & publish" primary action opens the First-Publish
  // Review flow (first-publish-review.tsx) instead, which calls
  // publish-selected, not this plain /publish. Take Offline is
  // non-cascading, so every Chapter/Lesson already sits at whatever status
  // it had before - there is no fresh selection to re-review here, hence no
  // embedded readiness summary the way the old first-publish flow needed.
  publish: {
    title: "courses.makeLiveAgainDialogTitle",
    body: "courses.makeLiveAgainDialogCopy",
    confirm: "courses.makeLiveAgainConfirm",
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
 * only action that removes the Course from normal active use; Take Offline,
 * Restore, and "Make live again" (publish) are all ordinary, reversible
 * actions.
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
    />
  );
}
