"use client";

import { useRef, useState } from "react";
import { getAuthService } from "@/lib/api/session";
import { useI18n } from "@/lib/i18n/i18n";
import type { TranslationKey } from "@/lib/i18n/translations";
import type { CourseSectionSummary } from "@/lib/api/types";
import { LifecycleActionDialog, type LifecycleActionCopy } from "@/features/instructor/lifecycle-action-dialog";
import { archiveSection, publishSection, restoreSection, unpublishSection } from "./sections-service";
import { isNetworkError, isSectionLifecycleConflict, resolveErrorMessageKey } from "./error-mapping";

export type SectionLifecycleAction = "publish" | "takeOffline" | "archive" | "restore";

const COPY: Record<SectionLifecycleAction, LifecycleActionCopy> = {
  publish: {
    title: "sections.publishDialogTitle",
    body: "sections.publishDialogCopy",
    confirm: "sections.publishConfirm",
    pending: "courses.publishing",
  },
  takeOffline: {
    title: "sections.takeOfflineDialogTitle",
    body: "sections.takeOfflineDialogCopy",
    confirm: "sections.takeOfflineConfirm",
    pending: "courses.takingOffline",
  },
  archive: {
    title: "sections.archiveDialogTitle",
    body: "sections.archiveDialogCopy",
    confirm: "sections.archiveConfirm",
    pending: "courses.archiving",
  },
  restore: {
    title: "sections.restoreDialogTitle",
    body: "sections.restoreDialogCopy",
    confirm: "sections.restoreConfirm",
    pending: "courses.restoring",
  },
};

const ERROR_FALLBACK: Record<SectionLifecycleAction, TranslationKey> = {
  publish: "sections.publishErrorGeneric",
  takeOffline: "sections.takeOfflineErrorGeneric",
  archive: "sections.archiveErrorGeneric",
  restore: "sections.restoreErrorGeneric",
};

/**
 * Mirrors Course's LifecycleConfirmDialog (same shared shell, same four
 * actions) - kept as its own component rather than merging into it, since
 * Section calls its own service module and error-mapping module. The
 * backend has no request body for any of these four endpoints, so the only
 * inputs are which action and which section.
 */
export function SectionLifecycleConfirmDialog({
  action,
  tenantId,
  courseId,
  section,
  onClose,
  onDone,
  onConflict,
}: {
  action: SectionLifecycleAction;
  tenantId: string;
  courseId: string;
  section: CourseSectionSummary;
  onClose: () => void;
  onDone: (result: CourseSectionSummary) => void;
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
          ? await publishSection(client, tenantId, courseId, section.sectionId)
          : action === "takeOffline"
            ? await unpublishSection(client, tenantId, courseId, section.sectionId)
            : action === "archive"
              ? await archiveSection(client, tenantId, courseId, section.sectionId)
              : await restoreSection(client, tenantId, courseId, section.sectionId);
      onDone(result);
    } catch (error) {
      if (isNetworkError(error)) {
        setBackendError(t("shell.apiUnavailable"));
      } else {
        setBackendError(t(resolveErrorMessageKey(error, ERROR_FALLBACK[action])));

        if (isSectionLifecycleConflict(error)) {
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
      titleId="section-lifecycle-title"
      entityTitle={section.title}
      copy={copy}
      danger={action === "archive"}
      backendError={backendError}
      submitting={submitting}
      onConfirm={confirm}
      onClose={onClose}
    />
  );
}
