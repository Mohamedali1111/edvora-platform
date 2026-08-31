"use client";

import { useRef, useState } from "react";
import { Modal } from "@/features/instructor/students/dialog";
import { getAuthService } from "@/lib/api/session";
import { useI18n } from "@/lib/i18n/i18n";
import type { TranslationKey } from "@/lib/i18n/translations";
import type { CourseSectionSummary } from "@/lib/api/types";
import { archiveSection, publishSection } from "./sections-service";
import { isNetworkError, isSectionLifecycleConflict, resolveErrorMessageKey } from "./error-mapping";

type LifecycleAction = "publish" | "archive";

const COPY: Record<
  LifecycleAction,
  { title: TranslationKey; body: TranslationKey; confirm: TranslationKey; pending: TranslationKey; errorFallback: TranslationKey }
> = {
  publish: {
    title: "sections.publishDialogTitle",
    body: "sections.publishDialogCopy",
    confirm: "sections.publishConfirm",
    pending: "courses.publishing",
    errorFallback: "sections.publishErrorGeneric",
  },
  archive: {
    title: "sections.archiveDialogTitle",
    body: "sections.archiveDialogCopy",
    confirm: "sections.archiveConfirm",
    pending: "courses.archiving",
    errorFallback: "sections.archiveErrorGeneric",
  },
};

/**
 * Mirrors Course's LifecycleConfirmDialog (same shape/behavior), kept as its
 * own component rather than generalizing the Course one - that file is
 * already-approved Slice D1 architecture and isn't touched here. The frozen
 * backend has no request body for either endpoint, so the only inputs are
 * which action and which section.
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
  action: LifecycleAction;
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
          : await archiveSection(client, tenantId, courseId, section.sectionId);
      onDone(result);
    } catch (error) {
      if (isNetworkError(error)) {
        setBackendError(t("shell.apiUnavailable"));
      } else {
        setBackendError(t(resolveErrorMessageKey(error, copy.errorFallback)));

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
    <Modal titleId="section-lifecycle-title" onClose={onClose}>
      <div className="auth-form">
        <h2 id="section-lifecycle-title">{t(copy.title)}</h2>
        <p className="form-note">
          {t(copy.body)} <strong>{section.title}</strong>
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
