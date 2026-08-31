"use client";

import { LoginForm } from "./login-form";
import { useI18n } from "@/lib/i18n/i18n";

export function LoginScreen() {
  const { t } = useI18n();

  return (
    <main className="login-page">
      <section className="login-brand" aria-labelledby="login-title">
        <div className="brand-mark" aria-hidden="true">
          E
        </div>
        <p className="brand-name">{t("brand.name")}</p>
        <div>
          <h1 id="login-title">{t("auth.title")}</h1>
          <p>{t("auth.subtitle")}</p>
        </div>
      </section>
      <section className="login-panel" aria-label={t("auth.title")}>
        <LoginForm />
      </section>
    </main>
  );
}
