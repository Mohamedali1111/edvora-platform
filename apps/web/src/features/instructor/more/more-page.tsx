"use client";

import Link from "next/link";
import { useInstructorSession } from "@/features/instructor/session-context";
import { useI18n } from "@/lib/i18n/i18n";
import { moreDestinations } from "./more";

export function MorePage() {
  const { t } = useI18n();
  const { session, logout } = useInstructorSession();
  const user = session.status === "authenticated" ? session.user : null;
  const tenant = session.status === "authenticated" ? session.tenant : null;

  return (
    <div className="more-page">
      <div className="page-header">
        <div>
          <h2>{t("nav.more")}</h2>
          <p className="page-subtitle">{t("more.subtitle")}</p>
        </div>
      </div>

      <section className="more-section" aria-labelledby="more-account-heading">
        <div>
          <h3 id="more-account-heading">{t("more.accountTitle")}</h3>
          {user && tenant ? (
            <p>
              <strong>{user.displayName ?? user.email}</strong>
              <span>{tenant.name}</span>
            </p>
          ) : null}
        </div>
        <button className="secondary-button compact-action" type="button" onClick={logout}>
          {t("shell.logout")}
        </button>
      </section>

      <nav className="more-section" aria-labelledby="more-secondary-heading">
        <div>
          <h3 id="more-secondary-heading">{t("more.secondaryTitle")}</h3>
          <p>{t("more.secondaryCopy")}</p>
        </div>
        <div className="more-actions">
          {moreDestinations.map((destination) => (
            <Link
              className={destination.visibility === "mobile" ? "secondary-button compact-action mobile-more-destination" : "secondary-button compact-action"}
              href={destination.href}
              key={destination.id}
            >
              {t(destination.labelKey)}
            </Link>
          ))}
        </div>
      </nav>
    </div>
  );
}
