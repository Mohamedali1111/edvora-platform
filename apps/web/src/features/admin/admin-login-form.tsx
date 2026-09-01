"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ApiError } from "@/lib/api/client";
import { getAuthService } from "@/lib/api/session";
import { validateLoginInput } from "@/lib/api/auth";
import { useI18n } from "@/lib/i18n/i18n";

/**
 * Platform Admin's own login form - a self-contained copy of
 * features/auth/login-form.tsx's structure (same field/validation/error
 * conventions) that calls `loginAdmin()` and redirects into `/admin/*`
 * instead. Kept separate rather than adding a role branch to the shared
 * instructor login form, per the "don't touch Instructor Web" rule; there
 * is no self-serve Platform Admin signup in V1 (accounts are provisioned
 * out of band), matching `auth.noReset`'s existing "handled by Edvora
 * support" convention re-used below.
 */
export function AdminLoginForm() {
  const router = useRouter();
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [backendError, setBackendError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validateLoginInput(email, password);
    setErrors(nextErrors);
    setBackendError(null);

    if (nextErrors.email || nextErrors.password) {
      return;
    }

    setIsSubmitting(true);

    try {
      const session = await getAuthService().loginAdmin(email.trim(), password);

      if (session.status === "authenticated") {
        router.replace("/admin/overview");
        return;
      }

      setBackendError(session.status === "forbidden" ? t("admin.shell.forbidden") : t("auth.backendError"));
    } catch (error) {
      setBackendError(error instanceof ApiError && error.kind === "network" ? t("admin.shell.apiUnavailable") : t("auth.backendError"));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={submit} noValidate>
      <div className="field">
        <label htmlFor="admin-email">{t("auth.email")}</label>
        <input
          id="admin-email"
          name="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          aria-invalid={errors.email ? "true" : "false"}
          aria-describedby={errors.email ? "admin-email-error" : undefined}
        />
        {errors.email ? (
          <p className="field-error" id="admin-email-error">
            {errors.email === "invalid" ? t("auth.emailInvalid") : t("auth.emailRequired")}
          </p>
        ) : null}
      </div>

      <div className="field">
        <label htmlFor="admin-password">{t("auth.password")}</label>
        <div className="password-control">
          <input
            id="admin-password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            aria-invalid={errors.password ? "true" : "false"}
            aria-describedby={errors.password ? "admin-password-error" : undefined}
          />
          <button className="ghost-button compact" type="button" onClick={() => setShowPassword((value) => !value)}>
            {showPassword ? t("auth.hidePassword") : t("auth.showPassword")}
          </button>
        </div>
        {errors.password ? (
          <p className="field-error" id="admin-password-error">
            {t("auth.passwordRequired")}
          </p>
        ) : null}
      </div>

      {backendError ? (
        <div className="form-error" role="alert">
          {backendError}
        </div>
      ) : null}

      <button className="primary-button" type="submit" disabled={isSubmitting}>
        {isSubmitting ? t("auth.loading") : t("auth.submit")}
      </button>

      <p className="form-note">{t("auth.noReset")}</p>
    </form>
  );
}
