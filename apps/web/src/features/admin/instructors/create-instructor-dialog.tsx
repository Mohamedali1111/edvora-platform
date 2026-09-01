"use client";

import { useRef, useState, type FormEvent } from "react";
import { getAuthService } from "@/lib/api/session";
import { useI18n } from "@/lib/i18n/i18n";
import type { CreatedInstructorResult } from "@/lib/api/types";
import { Modal } from "../dialog";
import { formatDateTime } from "../format";
import { createInstructor } from "./instructors-service";
import { isNetworkError, resolveErrorMessageKey } from "./error-mapping";
import { normalizeTenantSlug, validateCreateInstructorInput, type CreateInstructorValidationErrors } from "./validation";

/**
 * Two-phase dialog: the onboarding form, then - only on success - a
 * one-time activation handoff screen. Mirrors
 * features/instructor/students/add-student-dialog.tsx's exact secure
 * one-time-secret pattern (own copy, not a shared import, per the "don't mix
 * admin into instructor feature modules" rule) with one simplification:
 * `POST /admin/instructors` has no "existing account, no activation" branch
 * - it always creates a brand-new Instructor + Tenant and always returns a
 * fresh `activation.rawToken`, so there is only ever one success shape here.
 * The token lives only in this component's local state: never passed
 * upward beyond the boolean-shaped `onCreated` callback's own use, never
 * logged, never persisted, discarded the moment this dialog unmounts.
 */
export function CreateInstructorDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (result: CreatedInstructorResult) => void;
}) {
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [tenantName, setTenantName] = useState("");
  const [tenantSlug, setTenantSlug] = useState("");
  const [errors, setErrors] = useState<CreateInstructorValidationErrors>({});
  const [backendError, setBackendError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [result, setResult] = useState<CreatedInstructorResult | null>(null);
  const [copied, setCopied] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (submittingRef.current) {
      return;
    }

    const nextErrors = validateCreateInstructorInput({ email, displayName, tenantName, tenantSlug });
    setErrors(nextErrors);
    setBackendError(null);

    if (nextErrors.email || nextErrors.displayName || nextErrors.tenantName || nextErrors.tenantSlug) {
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);

    try {
      const trimmedDisplayName = displayName.trim();
      const created = await createInstructor(getAuthService().getClient(), {
        email: email.trim(),
        displayName: trimmedDisplayName ? trimmedDisplayName : undefined,
        tenantName: tenantName.trim(),
        tenantSlug: normalizeTenantSlug(tenantSlug),
      });
      setResult(created);
    } catch (error) {
      if (isNetworkError(error)) {
        setBackendError(t("admin.shell.apiUnavailable"));
      } else {
        setBackendError(t(resolveErrorMessageKey(error, "admin.instructors.errorGeneric")));
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
      await navigator.clipboard.writeText(result.activation.rawToken);
      setCopied(true);
    } catch {
      // Clipboard access can be unavailable/denied; the code stays visible and selectable regardless.
    }
  }

  function dismiss() {
    if (result) {
      onCreated(result);
    } else {
      onClose();
    }
  }

  if (result) {
    return (
      <Modal titleId="create-instructor-result-title" onClose={dismiss}>
        <div className="auth-form">
          <h2 id="create-instructor-result-title">{t("admin.instructors.activationTitle")}</h2>
          <p className="form-note">{t("admin.instructors.activationExplain")}</p>

          <dl className="detail-grid">
            <div>
              <dt>{t("admin.instructors.columnInstructor")}</dt>
              <dd>{result.displayName ?? result.email}</dd>
            </div>
            <div>
              <dt>{t("admin.instructors.columnTenant")}</dt>
              <dd>{result.tenantName}</dd>
            </div>
          </dl>

          <div className="admin-activation-token-box">
            <span className="admin-activation-token-label">
              <ActivationIcon />
              {t("admin.instructors.activationTokenLabel")}
            </span>
            <code className="admin-activation-token-value">{result.activation.rawToken}</code>
            <button className="ghost-button compact" type="button" onClick={copyToken}>
              {copied ? t("admin.instructors.activationCopiedConfirmation") : t("admin.instructors.activationCopyAction")}
            </button>
          </div>

          <p className="form-note">
            {t("admin.instructors.activationExpiresLabel")}: {formatDateTime(result.activation.expiresAt)}
          </p>

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
    <Modal titleId="create-instructor-title" onClose={onClose}>
      <form className="auth-form" onSubmit={submit} noValidate>
        <h2 id="create-instructor-title">{t("admin.instructors.createDialogTitle")}</h2>
        <p className="form-note">{t("admin.instructors.createDialogCopy")}</p>

        <div className="field">
          <label htmlFor="instructor-email">{t("admin.instructors.createEmailLabel")}</label>
          <input
            id="instructor-email"
            name="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            aria-invalid={errors.email ? "true" : "false"}
            aria-describedby={errors.email ? "instructor-email-error" : undefined}
            disabled={submitting}
          />
          {errors.email ? (
            <p className="field-error" id="instructor-email-error">
              {errors.email === "invalid" ? t("admin.instructors.createEmailInvalid") : t("admin.instructors.createEmailRequired")}
            </p>
          ) : null}
        </div>

        <div className="field">
          <label htmlFor="instructor-display-name">{t("admin.instructors.createDisplayNameLabel")}</label>
          <input
            id="instructor-display-name"
            name="displayName"
            type="text"
            maxLength={160}
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            aria-invalid={errors.displayName ? "true" : "false"}
            aria-describedby={errors.displayName ? "instructor-display-name-error" : undefined}
            disabled={submitting}
          />
          {errors.displayName ? (
            <p className="field-error" id="instructor-display-name-error">
              {t("admin.instructors.createDisplayNameTooLong")}
            </p>
          ) : null}
        </div>

        <div className="field">
          <label htmlFor="instructor-tenant-name">{t("admin.instructors.createTenantNameLabel")}</label>
          <input
            id="instructor-tenant-name"
            name="tenantName"
            type="text"
            maxLength={160}
            value={tenantName}
            onChange={(event) => setTenantName(event.target.value)}
            aria-invalid={errors.tenantName ? "true" : "false"}
            aria-describedby={errors.tenantName ? "instructor-tenant-name-error" : undefined}
            disabled={submitting}
          />
          {errors.tenantName ? (
            <p className="field-error" id="instructor-tenant-name-error">
              {errors.tenantName === "tooLong" ? t("admin.instructors.createTenantNameTooLong") : t("admin.instructors.createTenantNameRequired")}
            </p>
          ) : null}
        </div>

        <div className="field">
          <label htmlFor="instructor-tenant-slug">{t("admin.instructors.createTenantSlugLabel")}</label>
          <input
            id="instructor-tenant-slug"
            name="tenantSlug"
            type="text"
            maxLength={120}
            value={tenantSlug}
            onChange={(event) => setTenantSlug(event.target.value)}
            aria-invalid={errors.tenantSlug ? "true" : "false"}
            aria-describedby={errors.tenantSlug ? "instructor-tenant-slug-error" : "instructor-tenant-slug-hint"}
            disabled={submitting}
          />
          {errors.tenantSlug ? (
            <p className="field-error" id="instructor-tenant-slug-error">
              {errors.tenantSlug === "invalid" ? t("admin.instructors.createTenantSlugInvalid") : t("admin.instructors.createTenantSlugRequired")}
            </p>
          ) : (
            <p className="form-note" id="instructor-tenant-slug-hint">
              {t("admin.instructors.createTenantSlugHint")}
            </p>
          )}
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
            {submitting ? t("admin.instructors.createSubmitting") : t("admin.instructors.createSubmit")}
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
