"use client";

import { useRef, useState } from "react";
import { getAuthService } from "@/lib/api/session";
import { useI18n } from "@/lib/i18n/i18n";
import type { EnrollmentSummary } from "@/lib/api/types";
import { Modal } from "./dialog";
import { revokeEnrollment } from "./enrollments-service";
import { isNetworkError, resolveErrorMessageKey } from "./error-mapping";

/**
 * Deliberately unambiguous destructive-action UX: names the exact course
 * being revoked, requires an explicit confirm click (no default focus on
 * the destructive button), and disables both actions during the mutation.
 * Revoke is not idempotent on the backend (a second revoke 404s), so on
 * success this always triggers a real revalidation of the enrollment list
 * rather than any optimistic local state change.
 */
export function RevokeEnrollmentDialog({
  tenantId,
  enrollmentId,
  courseTitle,
  onClose,
  onRevoked,
}: {
  tenantId: string;
  enrollmentId: string;
  courseTitle: string;
  onClose: () => void;
  onRevoked: (result: EnrollmentSummary) => void;
}) {
  const { t } = useI18n();
  const [backendError, setBackendError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);

  async function confirmRevoke() {
    if (submittingRef.current) {
      return;
    }

    setBackendError(null);
    submittingRef.current = true;
    setSubmitting(true);

    try {
      const result = await revokeEnrollment(getAuthService().getClient(), tenantId, enrollmentId);
      onRevoked(result);
    } catch (error) {
      if (isNetworkError(error)) {
        setBackendError(t("shell.apiUnavailable"));
      } else {
        setBackendError(t(resolveErrorMessageKey(error, "enrollments.revokeErrorGeneric")));
      }
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <Modal titleId="revoke-enrollment-title" onClose={onClose}>
      <div className="auth-form">
        <h2 id="revoke-enrollment-title">{t("enrollments.revokeDialogTitle")}</h2>
        <p className="form-note">
          {t("enrollments.revokeDialogCopy")} <strong>{courseTitle}</strong>
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
          <button className="primary-button danger-button" type="button" onClick={confirmRevoke} disabled={submitting}>
            {submitting ? t("enrollments.revoking") : t("enrollments.revokeConfirm")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
