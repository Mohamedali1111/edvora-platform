"use client";

import { useRef, useState } from "react";
import { getAuthService } from "@/lib/api/session";
import { useI18n } from "@/lib/i18n/i18n";
import type { ActivationTokenResult, InstructorSummary } from "@/lib/api/types";
import { Modal } from "../dialog";
import { formatDateTime } from "../format";
import { reissueInstructorActivation } from "./instructors-service";
import { isNetworkError, resolveErrorMessageKey } from "./error-mapping";
import { ActivationDestination } from "./activation-destination";

/**
 * G-02 repair: the Admin-facing recovery path for an instructor whose original activation code
 * was lost or expired. Two-phase, mirroring CreateInstructorDialog's confirm-then-one-time-result
 * shape (and ReviewDeviceRequestDialog's confirm-then-act pattern) - a deliberate `POST
 * .../activation` never fires on open, only on explicit confirmation here. The issued
 * `activation.rawToken` lives only in this component's local state: never passed upward beyond
 * the boolean-shaped `onReissued` callback, never logged, discarded the moment this dialog
 * unmounts.
 */
export function ReissueActivationDialog({
  instructor,
  onClose,
  onReissued,
}: {
  instructor: InstructorSummary;
  onClose: () => void;
  onReissued: () => void;
}) {
  const { t } = useI18n();
  const [backendError, setBackendError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [result, setResult] = useState<ActivationTokenResult | null>(null);
  const [copied, setCopied] = useState(false);

  const name = instructor.displayName ?? instructor.email;
  const titleId = result ? "reissue-activation-result-title" : "reissue-activation-confirm-title";

  async function confirm() {
    if (submittingRef.current) {
      return;
    }

    setBackendError(null);
    submittingRef.current = true;
    setSubmitting(true);

    try {
      const activation = await reissueInstructorActivation(getAuthService().getClient(), instructor.userId);
      setResult(activation);
    } catch (error) {
      if (isNetworkError(error)) {
        setBackendError(t("admin.shell.apiUnavailable"));
      } else {
        setBackendError(t(resolveErrorMessageKey(error, "admin.instructors.reissueErrorGeneric")));
      }
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  async function copyToken() {
    if (!result) {
      return;
    }

    try {
      await navigator.clipboard.writeText(result.rawToken);
      setCopied(true);
    } catch {
      // Clipboard access can be unavailable/denied; the code stays visible and selectable regardless.
    }
  }

  function dismiss() {
    if (result) {
      onReissued();
    } else {
      onClose();
    }
  }

  if (result) {
    return (
      <Modal titleId={titleId} onClose={dismiss}>
        <div className="auth-form">
          <h2 id={titleId}>{t("admin.instructors.reissueResultTitle")}</h2>
          <p className="form-note">{t("admin.instructors.reissueResultExplain")}</p>

          <div className="admin-activation-token-box">
            <span className="admin-activation-token-label">
              <ActivationIcon />
              {t("admin.instructors.activationTokenLabel")}
            </span>
            <code className="admin-activation-token-value">{result.rawToken}</code>
            <button className="ghost-button compact" type="button" onClick={copyToken}>
              {copied ? t("admin.instructors.activationCopiedConfirmation") : t("admin.instructors.activationCopyAction")}
            </button>
          </div>

          <p className="form-note">
            {t("admin.instructors.activationExpiresLabel")}: {formatDateTime(result.expiresAt)}
          </p>

          <ActivationDestination />

          <div className="form-error" role="alert">
            {t("admin.instructors.activationOnceWarning")}
          </div>

          <div className="modal-actions">
            <button className="primary-button" type="button" onClick={dismiss}>
              {t("common.done")}
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal titleId={titleId} onClose={onClose}>
      <div className="auth-form">
        <h2 id={titleId}>{t("admin.instructors.reissueDialogTitle")}</h2>
        <p className="form-note">{t("admin.instructors.reissueDialogCopy").replace("{instructor}", name)}</p>

        {backendError ? (
          <div className="form-error" role="alert">
            {backendError}
          </div>
        ) : null}

        <div className="modal-actions">
          <button className="secondary-button" type="button" onClick={onClose} disabled={submitting} autoFocus>
            {t("common.cancel")}
          </button>
          <button className="primary-button" type="button" onClick={confirm} disabled={submitting}>
            {submitting ? t("admin.instructors.reissuing") : t("admin.instructors.reissueConfirm")}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function ActivationIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 2.5 3.5 5.5v4.6c0 4.15 2.75 6.9 6.5 7.9 3.75-1 6.5-3.75 6.5-7.9V5.5Z" />
      <path d="M7.4 10.2l1.8 1.8 3.4-3.6" />
    </svg>
  );
}
