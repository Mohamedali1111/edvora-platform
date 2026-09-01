"use client";

import { useRef, useState, type FormEvent } from "react";
import { getAuthService } from "@/lib/api/session";
import { useI18n } from "@/lib/i18n/i18n";
import type { AddTenantStudentResult } from "@/lib/api/types";
import { Modal } from "./dialog";
import { addStudent } from "./students-service";
import { isNetworkError, resolveErrorMessageKey } from "./error-mapping";
import { validateAddStudentInput } from "./validation";
import { formatDate } from "./format";

/**
 * Two-phase dialog: the add-student form, then - only on success - a
 * one-time activation handoff screen. The frozen backend has no email/SMS
 * delivery for STUDENT_ACTIVATION tokens (see docs/DECISIONS.md DEC-0046:
 * "activation-token delivery is still deferred") and deliberately returns
 * `activation.rawToken` in this endpoint's response for a brand-new account
 * (docs/TENANT-STUDENT-DESIGN.md describes it as "a deliverable activation
 * token", only ever returned once) - so surfacing it here, once, for the
 * instructor to relay out-of-band is the actual V1 contract, not an
 * invented one. The token lives only in this component's local state: it is
 * never passed to the parent, never logged, never stored, and is discarded
 * the moment this dialog unmounts (Done/Escape/backdrop all route through
 * the same dismiss handler that hands the parent only a boolean-shaped
 * result, not the secret).
 */
export function AddStudentDialog({
  tenantId,
  onClose,
  onAdded,
}: {
  tenantId: string;
  onClose: () => void;
  onAdded: (result: AddTenantStudentResult) => void;
}) {
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [errors, setErrors] = useState<{ email?: "required" | "invalid"; displayName?: "tooLong" }>({});
  const [backendError, setBackendError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [result, setResult] = useState<AddTenantStudentResult | null>(null);
  const [copied, setCopied] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (submittingRef.current) {
      return;
    }

    const nextErrors = validateAddStudentInput(email, displayName);
    setErrors(nextErrors);
    setBackendError(null);

    if (nextErrors.email || nextErrors.displayName) {
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);

    try {
      const trimmedDisplayName = displayName.trim();
      const added = await addStudent(getAuthService().getClient(), tenantId, {
        email: email.trim(),
        displayName: trimmedDisplayName ? trimmedDisplayName : undefined,
      });
      setResult(added);
    } catch (error) {
      if (isNetworkError(error)) {
        setBackendError(t("shell.apiUnavailable"));
      } else {
        setBackendError(t(resolveErrorMessageKey(error, "students.addErrorGeneric")));
      }
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  async function copyToken() {
    if (!result?.activation) {
      return;
    }

    try {
      await navigator.clipboard.writeText(result.activation.rawToken);
      setCopied(true);
    } catch {
      // Clipboard access can be unavailable/denied; the code stays visible and selectable regardless.
    }
  }

  function dismiss() {
    if (result) {
      onAdded(result);
    } else {
      onClose();
    }
  }

  if (result) {
    return (
      <Modal titleId="add-student-result-title" onClose={dismiss}>
        <div className="auth-form">
          {result.activation ? (
            <>
              <h2 id="add-student-result-title">{t("students.activationTitle")}</h2>
              <p className="form-note">{t("students.activationExplain")}</p>

              <div className="activation-token-box">
                <span className="activation-token-label">
                  <ActivationIcon />
                  {t("students.activationTokenLabel")}
                </span>
                <code className="activation-token-value">{result.activation.rawToken}</code>
                <button className="ghost-button compact" type="button" onClick={copyToken}>
                  {copied ? t("students.activationCopiedConfirmation") : t("students.activationCopyAction")}
                </button>
              </div>

              <p className="form-note">
                {t("students.activationExpiresLabel")}: {formatDate(result.activation.expiresAt)}
              </p>

              <div className="form-error" role="alert">
                {t("students.activationOnceWarning")}
              </div>
            </>
          ) : (
            <>
              <h2 id="add-student-result-title">{t("students.addSuccessExistingTitle")}</h2>
              <p className="form-note">{t("students.addSuccess")}</p>
            </>
          )}

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
    <Modal titleId="add-student-title" onClose={onClose}>
      <form className="auth-form" onSubmit={submit} noValidate>
        <h2 id="add-student-title">{t("students.addDialogTitle")}</h2>
        <p className="form-note">{t("students.addDialogCopy")}</p>

        <div className="field">
          <label htmlFor="student-email">{t("students.addEmailLabel")}</label>
          <input
            id="student-email"
            name="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            aria-invalid={errors.email ? "true" : "false"}
            aria-describedby={errors.email ? "student-email-error" : undefined}
          />
          {errors.email ? (
            <p className="field-error" id="student-email-error">
              {errors.email === "invalid" ? t("students.addEmailInvalid") : t("students.addEmailRequired")}
            </p>
          ) : null}
        </div>

        <div className="field">
          <label htmlFor="student-display-name">{t("students.addDisplayNameLabel")}</label>
          <input
            id="student-display-name"
            name="displayName"
            type="text"
            maxLength={160}
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            aria-invalid={errors.displayName ? "true" : "false"}
            aria-describedby={errors.displayName ? "student-display-name-error" : undefined}
          />
          {errors.displayName ? (
            <p className="field-error" id="student-display-name-error">
              {t("students.addDisplayNameTooLong")}
            </p>
          ) : null}
        </div>

        {backendError ? (
          <div className="form-error" role="alert">
            {backendError}
          </div>
        ) : null}

        <div className="modal-actions">
          <button className="secondary-button" type="button" onClick={onClose} disabled={submitting}>
            {t("common.cancel")}
          </button>
          <button className="primary-button" type="submit" disabled={submitting}>
            {submitting ? t("students.addSubmitting") : t("students.addSubmit")}
          </button>
        </div>
      </form>
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
