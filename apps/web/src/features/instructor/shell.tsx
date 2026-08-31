"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import { useI18n } from "@/lib/i18n/i18n";
import { instructorSections, resolveInstructorSection, type InstructorSection } from "./navigation";
import { useInstructorSession } from "./session-context";

/**
 * Owns the persistent instructor chrome (sidebar, topbar, mobile drawer) and
 * the non-authenticated recovery screens. Mounted once by
 * apps/web/src/app/instructor/layout.tsx; `children` is whichever section
 * page Next.js has routed to, and only ever renders while the session is
 * authenticated.
 */
export function InstructorShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { t, locale, setLocale, dir } = useI18n();
  const { session, retry, logout } = useInstructorSession();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const activeSection = useMemo(() => resolveInstructorSection(pathname), [pathname]);
  const activeTitle = activeSection
    ? t(instructorSections.find((section) => section.id === activeSection)!.labelKey)
    : t("shell.notFoundTitle");

  if (session.status === "bootstrapping") {
    return <CenteredState title={t("shell.loading")} />;
  }

  if (session.status !== "authenticated") {
    if (session.status === "api-unavailable") {
      return (
        <CenteredState title={t("shell.apiUnavailable")}>
          <button className="primary-button compact-action" type="button" onClick={retry}>
            {t("shell.retry")}
          </button>
        </CenteredState>
      );
    }

    const messageKey = session.status === "expired" ? "shell.expired" : "shell.forbidden";

    return (
      <CenteredState title={t(messageKey)}>
        <button className="primary-button compact-action" type="button" onClick={() => router.replace("/auth/login")}>
          {t("shell.goToLogin")}
        </button>
      </CenteredState>
    );
  }

  const navigation = (
    <Navigation active={activeSection} onNavigate={() => setDrawerOpen(false)} />
  );

  return (
    <div className="app-shell" data-dir={dir}>
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="brand-mark small" aria-hidden="true">
            E
          </div>
          <span>{t("brand.name")}</span>
        </div>
        {navigation}
      </aside>

      <div className="shell-main">
        <header className="topbar">
          <button className="icon-button mobile-only" type="button" onClick={() => setDrawerOpen(true)} aria-label={t("shell.openMenu")}>
            <span className="menu-bars" aria-hidden="true" />
          </button>
          <div className="title-area">
            <p>{session.tenant.name}</p>
            <h1>{activeTitle}</h1>
          </div>
          <div className="header-actions">
            <label className="language-control">
              <span>{t("shell.language")}</span>
              <select value={locale} onChange={(event) => setLocale(event.target.value === "ar" ? "ar" : "en")}>
                <option value="en">English</option>
                <option value="ar">العربية</option>
              </select>
            </label>
            <button className="secondary-button" type="button" onClick={logout}>
              {t("shell.logout")}
            </button>
          </div>
        </header>

        <main className="content" tabIndex={-1}>
          <div className="context-strip" aria-label={t("shell.tenant")}>
            <div>
              <span>{t("shell.account")}</span>
              <strong>{session.user.displayName ?? session.user.email}</strong>
            </div>
            <div>
              <span>{t("shell.tenant")}</span>
              <strong>{session.tenant.name}</strong>
            </div>
          </div>

          {children}
        </main>
      </div>

      {drawerOpen ? (
        <div className="drawer-layer" role="dialog" aria-modal="true" aria-label={t("shell.openMenu")}>
          <button className="drawer-scrim" type="button" aria-label={t("shell.closeMenu")} onClick={() => setDrawerOpen(false)} />
          <nav className="drawer-panel">
            <div className="drawer-header">
              <span>{t("brand.name")}</span>
              <button className="ghost-button compact" type="button" onClick={() => setDrawerOpen(false)}>
                {t("shell.closeMenu")}
              </button>
            </div>
            {navigation}
          </nav>
        </div>
      ) : null}
    </div>
  );
}

function Navigation({ active, onNavigate }: { active: InstructorSection | null; onNavigate: () => void }) {
  const { t } = useI18n();

  return (
    <nav className="nav-list" aria-label={t("shell.navigation")}>
      {instructorSections.map((item) => (
        <Link
          className={item.id === active ? "nav-link active" : "nav-link"}
          href={item.href}
          key={item.id}
          onClick={onNavigate}
          aria-current={item.id === active ? "page" : undefined}
        >
          <span aria-hidden="true" className="nav-dot" />
          <span>{t(item.labelKey)}</span>
        </Link>
      ))}
    </nav>
  );
}

function CenteredState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <main className="centered-state">
      <div className="loading-mark" aria-hidden="true" />
      <h1>{title}</h1>
      {children}
    </main>
  );
}
