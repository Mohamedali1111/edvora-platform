"use client";

import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { getAuthService } from "@/lib/api/session";
import { useI18n } from "@/lib/i18n/i18n";
import { activateInstructorAccount } from "./activate-client";
import { isNetworkError, resolveErrorMessageKey } from "./error-mapping";
import { validateActivationInput, type ActivationFieldErrors } from "./validation";

const FIELD_ERROR_KEY: Record<"required" | "tooShort", "auth.activate.passwordRequired" | "auth.activate.passwordTooShort"> = {
  required: "auth.activate.passwordRequired",
  tooShort: "auth.activate.passwordTooShort",
};

/**
 * G-01 repair: the one public form that lets a newly onboarded Instructor establish their own
 * password from the one-time activation code a Platform Admin handed them. Self-contained, two
 * phases (form, then a one-time success panel) exactly like CreateInstructorDialog's own
 * request/result split - never lifts either the activation code or the chosen password to a
 * parent component. Both secrets live only in this component's own `useState`: never written to
 * localStorage/sessionStorage, never placed in the URL/query string, never logged, and cleared
 * from state immediately on success so nothing lingers after the backend has already consumed
 * the token. `POST /auth/activate` never returns a session for this flow (see
 * `AuthOrchestrationService.activateAccount`), so success here means "go sign in", never an
 * invented auto-login.
 */
export function ActivateForm() {
  const { t } = useI18n();
  const [activationToken, setActivationToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<ActivationFieldErrors>({});
  const [backendError, setBackendError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [succeeded, setSucceeded] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (submittingRef.current) {
      return;
    }

    const errors = validateActivationInput({ activationToken, newPassword, confirmPassword });
    setFieldErrors(errors);
    setBackendError(null);

    if (errors.activationToken || errors.newPassword || errors.confirmPassword) {
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);

    try {
      await activateInstructorAccount(getAuthService().getClient(), {
        activationToken: activationToken.trim(),
        newPassword,
      });
      // The activation code and the chosen password are single-use/credential secrets - clear
      // them from runtime state immediately on success so nothing lingers here (or in a
      // component inspector) after the backend has already consumed the token.
      setActivationToken("");
      setNewPassword("");
      setConfirmPassword("");
      setSucceeded(true);
    } catch (error) {
      if (isNetworkError(error)) {
        setBackendError(t("auth.activate.error.network"));
      } else {
        setBackendError(t(resolveErrorMessageKey(error, "auth.activate.error.generic")));
      }
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  if (succeeded) {
    return (
      <div className="auth-form">
        <h2 id="activate-success-title">{t("auth.activate.successTitle")}</h2>
        <p className="form-note">{t("auth.activate.successCopy")}</p>
        <Link className="primary-button compact-action" href="/auth/login">
          {t("auth.activate.backToLogin")}
        </Link>
      </div>
    );
  }

  return (
    <form className="auth-form" onSubmit={submit} noValidate>
      <div className="field">
        <label htmlFor="activation-token">{t("auth.activate.tokenLabel")}</label>
        <input
          id="activation-token"
          name="activationToken"
          type="text"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          placeholder={t("auth.activate.tokenPlaceholder")}
          value={activationToken}
          onChange={(event) => setActivationToken(event.target.value)}
          aria-invalid={fieldErrors.activationToken ? "true" : "false"}
          aria-describedby={fieldErrors.activationToken ? "activation-token-error" : undefined}
          disabled={submitting}
        />
        {fieldErrors.activationToken ? (
          <p className="field-error" id="activation-token-error">
            {t("auth.activate.tokenRequired")}
          </p>
        ) : null}
      </div>

      <div className="field">
        <label htmlFor="activation-new-password">{t("auth.activate.newPasswordLabel")}</label>
        <div className="password-control">
          <input
            id="activation-new-password"
            name="newPassword"
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            aria-invalid={fieldErrors.newPassword ? "true" : "false"}
            aria-describedby={fieldErrors.newPassword ? "activation-new-password-error" : undefined}
            disabled={submitting}
          />
          <button className="ghost-button compact" type="button" onClick={() => setShowPassword((value) => !value)}>
            {showPassword ? t("auth.hidePassword") : t("auth.showPassword")}
          </button>
        </div>
        {fieldErrors.newPassword ? (
          <p className="field-error" id="activation-new-password-error">
            {t(FIELD_ERROR_KEY[fieldErrors.newPassword])}
          </p>
        ) : null}
      </div>

      <div className="field">
        <label htmlFor="activation-confirm-password">{t("auth.activate.confirmPasswordLabel")}</label>
        <div className="password-control">
          <input
            id="activation-confirm-password"
            name="confirmPassword"
            type={showConfirmPassword ? "text" : "password"}
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            aria-invalid={fieldErrors.confirmPassword ? "true" : "false"}
            aria-describedby={fieldErrors.confirmPassword ? "activation-confirm-password-error" : undefined}
            disabled={submitting}
          />
          <button
            className="ghost-button compact"
            type="button"
            onClick={() => setShowConfirmPassword((value) => !value)}
          >
            {showConfirmPassword ? t("auth.hidePassword") : t("auth.showPassword")}
          </button>
        </div>
        {fieldErrors.confirmPassword ? (
          <p className="field-error" id="activation-confirm-password-error">
            {t("auth.activate.passwordMismatch")}
          </p>
        ) : null}
      </div>

      {backendError ? (
        <div className="form-error" role="alert">
          {backendError}
        </div>
      ) : null}

      <button className="primary-button" type="submit" disabled={submitting}>
        {submitting ? t("auth.activate.submitting") : t("auth.activate.submit")}
      </button>

      <p className="form-note">
        <Link href="/auth/login">{t("auth.activate.backToLogin")}</Link>
      </p>
    </form>
  );
}
