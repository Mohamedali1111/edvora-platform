"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n/i18n";
import { useAuthenticatedAdminSession } from "../session-context";

/**
 * Restrained operational landing page: a real link into the one real
 * workflow this milestone ships (Device Requests), no fabricated
 * dashboards/metrics. The frozen backend has no aggregate admin-overview
 * endpoint (no request counts, no tenant/user totals), so this page never
 * fetches or derives a number from a partial page - see docs/STATUS.md and
 * the admin-device-requests inventory this milestone was built from.
 */
export function AdminOverview() {
  const { t } = useI18n();
  const { user } = useAuthenticatedAdminSession();

  return (
    <div className="admin-page">
      <div className="admin-overview-intro">
        <p>{t("admin.overview.eyebrow")}</p>
        <h2>{t("admin.overview.title")}</h2>
        <p className="admin-overview-subtitle">
          {t("admin.overview.copy").replace("{name}", user.displayName ?? user.email)}
        </p>
      </div>

      <Link className="admin-overview-card" href="/admin/device-requests">
        <div>
          <h2>{t("admin.overview.deviceRequestsCardTitle")}</h2>
          <p>{t("admin.overview.deviceRequestsCardCopy")}</p>
        </div>
        <span className="admin-overview-card-action">
          {t("admin.overview.deviceRequestsCardAction")}
          <span className="admin-card-arrow" aria-hidden="true" />
        </span>
      </Link>
    </div>
  );
}
