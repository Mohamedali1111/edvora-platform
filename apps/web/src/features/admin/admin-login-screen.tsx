"use client";

import { AdminLoginForm } from "./admin-login-form";
import { useI18n } from "@/lib/i18n/i18n";

/** Mirrors features/auth/login-screen.tsx's layout, reusing the same shared `.login-*` CSS. */
export function AdminLoginScreen() {
  const { t } = useI18n();

  return (
    <main className="login-page">
      <section className="login-brand" aria-labelledby="admin-login-title">
        <div className="brand-mark" aria-hidden="true">
          E
        </div>
        <p className="brand-name">{t("brand.name")}</p>
        <div>
          <h1 id="admin-login-title">{t("admin.auth.title")}</h1>
          <p>{t("admin.auth.subtitle")}</p>
        </div>
      </section>
      <section className="login-panel" aria-label={t("admin.auth.title")}>
        <AdminLoginForm />
      </section>
    </main>
  );
}
