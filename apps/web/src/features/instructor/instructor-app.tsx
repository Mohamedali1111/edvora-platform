"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { getAuthService } from "@/lib/api/session";
import type { CurrentUser, TenantContext } from "@/lib/api/types";
import { useI18n } from "@/lib/i18n/i18n";
import { instructorSections, type InstructorSection } from "./navigation";

type ViewState =
  | { status: "bootstrapping" }
  | { status: "authenticated"; user: CurrentUser; tenant: TenantContext }
  | { status: "api-unavailable" }
  | { status: "expired" }
  | { status: "forbidden" };

export function InstructorApp({ section }: { section: InstructorSection }) {
  const router = useRouter();
  const { t, locale, setLocale, dir } = useI18n();
  const [state, setState] = useState<ViewState>({ status: "bootstrapping" });
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;

    getAuthService()
      .bootstrap()
      .then((session) => {
        if (cancelled) {
          return;
        }

        if (session.status === "authenticated" && session.user && session.tenant) {
          setState({ status: "authenticated", user: session.user, tenant: session.tenant });
          return;
        }

        if (session.status === "anonymous") {
          router.replace("/auth/login");
          return;
        }

        if (session.status === "api-unavailable" || session.status === "expired" || session.status === "forbidden") {
          setState({ status: session.status });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setState({ status: "api-unavailable" });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [router]);

  const activeTitle = useMemo(() => {
    const active = instructorSections.find((item) => item.id === section) ?? instructorSections[0];
    return t(active.labelKey);
  }, [section, t]);

  async function logout() {
    await getAuthService().logout();
    router.replace("/auth/login");
  }

  if (state.status === "bootstrapping") {
    return <CenteredState title={t("shell.loading")} />;
  }

  if (state.status !== "authenticated") {
    const messageKey =
      state.status === "api-unavailable"
        ? "shell.apiUnavailable"
        : state.status === "expired"
          ? "shell.expired"
          : "shell.forbidden";

    return (
      <CenteredState title={t(messageKey)}>
        <button className="primary-button compact-action" type="button" onClick={() => router.replace("/auth/login")}>
          {t("auth.submit")}
        </button>
      </CenteredState>
    );
  }

  const navigation = (
    <Navigation
      active={section}
      closeLabel={t("shell.closeMenu")}
      onNavigate={() => setDrawerOpen(false)}
    />
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
            <p>{state.tenant.name}</p>
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
              <strong>{state.user.displayName ?? state.user.email}</strong>
            </div>
            <div>
              <span>{t("shell.tenant")}</span>
              <strong>{state.tenant.name}</strong>
            </div>
          </div>

          {section === "overview" ? (
            <Overview user={state.user} tenant={state.tenant} />
          ) : (
            <Placeholder title={activeTitle} />
          )}
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

function Navigation({
  active,
  onNavigate,
}: {
  active: InstructorSection;
  closeLabel: string;
  onNavigate: () => void;
}) {
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

function Overview({ user, tenant }: { user: CurrentUser; tenant: TenantContext }) {
  const { t } = useI18n();

  return (
    <section className="overview-panel" aria-labelledby="overview-title">
      <p>{tenant.name}</p>
      <h2 id="overview-title">
        {t("overview.welcome")}, {user.displayName ?? user.email}
      </h2>
      <p>{t("overview.copy")}</p>
      <div className="security-note">{t("overview.security")}</div>
    </section>
  );
}

function Placeholder({ title }: { title: string }) {
  const { t } = useI18n();

  return (
    <section className="placeholder-panel" aria-labelledby="placeholder-title">
      <p>{title}</p>
      <h2 id="placeholder-title">{t("placeholder.title")}</h2>
      <p>{t("placeholder.copy")}</p>
    </section>
  );
}

function CenteredState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <main className="centered-state">
      <div className="loading-mark" aria-hidden="true" />
      <h1>{title}</h1>
      {children}
    </main>
  );
}
