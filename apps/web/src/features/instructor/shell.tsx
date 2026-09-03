"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import { useI18n } from "@/lib/i18n/i18n";
import { NavIcon } from "./nav-icons";
import { instructorMobileSections, instructorPrimarySections, resolveInstructorSection, type InstructorNavItem, type InstructorSection } from "./navigation";
import { useInstructorSession } from "./session-context";
import { ThemeControl } from "./theme-control";

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
  const bottomActiveSection = activeSection === "progress" ? "more" : activeSection;
  const activeTitle = activeSection
    ? t(instructorPrimarySections.find((section) => section.id === activeSection)!.labelKey)
    : t("shell.notFoundTitle");

  if (session.status === "bootstrapping") {
    return <CenteredState title={t("shell.loading")} loading />;
  }

  if (session.status !== "authenticated") {
    if (session.status === "api-unavailable") {
      return (
        <CenteredState title={t("shell.apiUnavailable")} alert>
          <button className="primary-button compact-action" type="button" onClick={retry}>
            {t("shell.retry")}
          </button>
        </CenteredState>
      );
    }

    const messageKey = session.status === "expired" ? "shell.expired" : "shell.forbidden";

    return (
      <CenteredState title={t(messageKey)} alert>
        <button className="primary-button compact-action" type="button" onClick={() => router.replace("/auth/login")}>
          {t("shell.goToLogin")}
        </button>
      </CenteredState>
    );
  }

  const identityInitial = (session.user.displayName ?? session.user.email).trim().charAt(0).toUpperCase();

  const navigation = (
    <Navigation items={instructorPrimarySections} active={activeSection} onNavigate={() => setDrawerOpen(false)} />
  );

  const identityRow = (
    <div className="sidebar-identity">
      <span className="identity-avatar" aria-hidden="true">
        {identityInitial}
      </span>
      <div className="identity-text">
        <strong>{session.user.displayName ?? session.user.email}</strong>
        <span>{session.tenant.name}</span>
      </div>
    </div>
  );

  // Logout lives in the desktop topbar (always visible there) and, on
  // mobile - where the topbar drops it to keep the first row compact - as
  // a real action right next to the identity it belongs to in the drawer.
  // It's never removed, only relocated to the one place that already shows
  // "who am I" on that breakpoint.
  const drawerFooter = (
    <div className="sidebar-footer">
      {identityRow}
      <button className="drawer-logout-button" type="button" onClick={logout}>
        <LogoutIcon />
        {t("shell.logout")}
      </button>
    </div>
  );

  const languageControl = (
    <label className="language-control">
      <span className="sr-only">{t("shell.language")}</span>
      <select value={locale} onChange={(event) => setLocale(event.target.value === "ar" ? "ar" : "en")}>
        <option value="en">EN</option>
        <option value="ar">AR</option>
      </select>
    </label>
  );

  return (
    <div className="app-shell" data-dir={dir}>
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="brand-mark small" aria-hidden="true">
            E
          </div>
          <span className="brand-name">{t("brand.name")}</span>
        </div>

        {navigation}

        <div className="sidebar-footer">{identityRow}</div>
      </aside>

      <div className="shell-main">
        <header className="topbar">
          <button className="icon-button mobile-only" type="button" onClick={() => setDrawerOpen(true)} aria-label={t("shell.openMenu")}>
            <span className="menu-bars" aria-hidden="true" />
          </button>

          <div className="title-area">
            <h1>{activeTitle}</h1>
          </div>

          <div className="header-actions">
            <div className="topbar-utility">
              <ThemeControl />
              {languageControl}
            </div>

            <button className="secondary-button compact-action logout-button" type="button" onClick={logout}>
              {t("shell.logout")}
            </button>
          </div>
        </header>

        <main className="content" tabIndex={-1}>
          {children}
        </main>
      </div>

      <Navigation items={instructorMobileSections} active={bottomActiveSection} onNavigate={() => setDrawerOpen(false)} variant="bottom" />

      {drawerOpen ? (
        <div className="drawer-layer" role="dialog" aria-modal="true" aria-label={t("shell.openMenu")}>
          <button className="drawer-scrim" type="button" aria-label={t("shell.closeMenu")} onClick={() => setDrawerOpen(false)} />
          <nav className="drawer-panel">
            <div className="drawer-header">
              <div className="sidebar-brand">
                <div className="brand-mark small" aria-hidden="true">
                  E
                </div>
                <span className="brand-name">{t("brand.name")}</span>
              </div>
              <button className="icon-button" type="button" onClick={() => setDrawerOpen(false)} aria-label={t("shell.closeMenu")}>
                <span className="close-mark" aria-hidden="true" />
              </button>
            </div>

            {navigation}

            {drawerFooter}
          </nav>
        </div>
      ) : null}
    </div>
  );
}

function LogoutIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 17H4.75A1.75 1.75 0 0 1 3 15.25v-10.5C3 3.784 3.784 3 4.75 3H8" />
      <path d="M13.5 14 17 10.5 13.5 7" />
      <path d="M17 10.5H8" />
    </svg>
  );
}

function Navigation({
  items,
  active,
  onNavigate,
  variant = "rail",
}: {
  items: InstructorNavItem[];
  active: InstructorSection | null;
  onNavigate: () => void;
  variant?: "rail" | "bottom";
}) {
  const { t } = useI18n();

  return (
    <nav className={variant === "bottom" ? "bottom-nav" : "nav-list"} aria-label={variant === "bottom" ? t("shell.mobileNavigation") : t("shell.navigation")}>
      {items.map((item) => (
        <Link
          className={item.id === active ? "nav-link active" : "nav-link"}
          href={item.href}
          key={item.id}
          onClick={onNavigate}
          aria-current={item.id === active ? "page" : undefined}
        >
          <span className="nav-icon" aria-hidden="true">
            <NavIcon section={item.id} />
          </span>
          <span>{t(item.labelKey)}</span>
        </Link>
      ))}
    </nav>
  );
}

/**
 * The pre-shell gate every instructor session passes through: a genuine
 * in-progress bootstrap (`loading`, spinner shown, `role="status"` so
 * screen readers hear it), or a terminal outcome the instructor must act on
 * (`alert`, no spinner - a spinner next to a "try again"/"go to sign in"
 * button falsely implies the app is still retrying on its own, and
 * `role="alert"` announces the failure proactively instead of relying on
 * the instructor to discover it visually).
 */
function CenteredState({
  title,
  children,
  loading = false,
  alert = false,
}: {
  title: string;
  children?: ReactNode;
  loading?: boolean;
  alert?: boolean;
}) {
  return (
    <main className="centered-state" role={loading ? "status" : alert ? "alert" : undefined}>
      {loading ? <div className="loading-mark" aria-hidden="true" /> : null}
      <h1>{title}</h1>
      {children}
    </main>
  );
}
