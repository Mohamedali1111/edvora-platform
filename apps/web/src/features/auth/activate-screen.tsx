"use client";

import { ActivateForm } from "./activate-form";
import { useI18n } from "@/lib/i18n/i18n";

/**
 * Mirrors features/auth/login-screen.tsx's exact two-pane layout and shared `.login-*` CSS, so
 * Instructor Web's activation entry point (G-01) reads as part of the same product as login, not
 * a bolted-on page. Deliberately unauthenticated: nothing in this tree reads or requires a
 * session (see app/auth/activate/page.tsx - it renders outside both the Instructor and Admin
 * authenticated shells).
 */
export function ActivateScreen() {
  const { t } = useI18n();

  return (
    <main className="login-page">
      <section className="login-brand" aria-labelledby="activate-title">
        <div className="brand-mark" aria-hidden="true">
          E
        </div>
        <p className="brand-name">{t("brand.name")}</p>
        <div>
          <h1 id="activate-title">{t("auth.activate.title")}</h1>
          <p>{t("auth.activate.subtitle")}</p>
        </div>
      </section>
      <section className="login-panel" aria-label={t("auth.activate.title")}>
        <ActivateForm />
      </section>
    </main>
  );
}
