"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n/i18n";
import { formatDate } from "../format";
import { isNetworkError, resolveErrorMessageKey } from "./error-mapping";
import { useInstructorDetail } from "./instructors-service";

/**
 * Read-only detail page - the frozen backend has no PATCH/update on
 * `/admin/instructors/:instructorId`, so nothing here is editable. Clearly
 * separates Instructor identity from the Tenant/Academy they own, since one
 * onboarding operation always creates exactly one of each together.
 */
export function InstructorDetail({ instructorId }: { instructorId: string }) {
  const { t } = useI18n();
  const { state, retry } = useInstructorDetail(instructorId);

  return (
    <div className="detail-page">
      <Link href="/admin/instructors" className="back-link">
        <span className="back-arrow" aria-hidden="true" />
        {t("admin.instructors.detailBack")}
      </Link>

      {state.status === "loading" ? (
        <p className="admin-overview-loading" role="status">
          {t("admin.instructors.loading")}
        </p>
      ) : state.status === "error" ? (
        <div className="admin-overview-error" role="alert">
          <p>
            {isNetworkError(state.error)
              ? t("admin.shell.apiUnavailable")
              : t(resolveErrorMessageKey(state.error, "admin.instructors.detailGenericError"))}
          </p>
          <button className="secondary-button compact-action" type="button" onClick={retry}>
            {t("admin.shell.retry")}
          </button>
        </div>
      ) : (
        <>
          <header className="detail-header">
            <h2>{state.data.displayName ?? state.data.email}</h2>
            <span className={`status-badge status-badge-${state.data.accountStatus.toLowerCase()}`}>
              {state.data.accountStatus}
            </span>
          </header>

          <section className="detail-section">
            <div className="detail-section-header">
              <h2>{t("admin.instructors.detailInstructorSectionTitle")}</h2>
            </div>
            <dl className="detail-grid">
              <div>
                <dt>{t("admin.instructors.detailEmailLabel")}</dt>
                <dd>{state.data.email}</dd>
              </div>
              <div>
                <dt>{t("admin.instructors.detailCreatedLabel")}</dt>
                <dd>{formatDate(state.data.createdAt)}</dd>
              </div>
            </dl>
          </section>

          <section className="detail-section">
            <div className="detail-section-header">
              <h2>{t("admin.instructors.detailTenantSectionTitle")}</h2>
            </div>
            <dl className="detail-grid">
              <div>
                <dt>{t("admin.instructors.detailTenantNameLabel")}</dt>
                <dd>{state.data.tenantName}</dd>
              </div>
              <div>
                <dt>{t("admin.instructors.detailTenantSlugLabel")}</dt>
                <dd className="id-value">{state.data.tenantSlug}</dd>
              </div>
              <div>
                <dt>{t("admin.instructors.detailMembershipRoleLabel")}</dt>
                <dd>{state.data.membershipRole}</dd>
              </div>
            </dl>
          </section>
        </>
      )}
    </div>
  );
}
