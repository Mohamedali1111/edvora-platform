"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n/i18n";

/**
 * Rendered by Next.js inside instructor/layout.tsx (so the sidebar/topbar
 * stay in place) whenever a URL under /instructor doesn't match any known
 * section. The topbar's own h1 already reads "Page not found" (see
 * shell.tsx); this body gives the explanation and a real way back in.
 */
export default function InstructorNotFound() {
  const { t } = useI18n();

  return (
    <section className="placeholder-panel" aria-labelledby="not-found-title">
      <h2 id="not-found-title">{t("shell.notFoundTitle")}</h2>
      <p>{t("shell.notFoundCopy")}</p>
      <Link className="primary-button compact-action" href="/instructor/overview">
        {t("nav.overview")}
      </Link>
    </section>
  );
}
