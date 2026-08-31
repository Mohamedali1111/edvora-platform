"use client";

import Link from "next/link";
import { useAuthenticatedInstructorSession } from "@/features/instructor/session-context";
import { useI18n } from "@/lib/i18n/i18n";
import type { TranslationKey } from "@/lib/i18n/translations";
import type { TenantStudentStatus } from "@/lib/api/types";
import { useStudentDetail } from "./students-service";
import { EnrollmentsSection } from "./enrollments-section";
import { isNetworkError, resolveErrorMessageKey } from "./error-mapping";
import { formatDate } from "./format";

const STUDENT_STATUS_KEY: Record<TenantStudentStatus, TranslationKey> = {
  ACTIVE: "status.studentActive",
  INACTIVE: "status.studentInactive",
  REMOVED: "status.studentRemoved",
};

/**
 * `studentId` (from the URL) only ever selects which student to display -
 * the tenant used for every request is always the authenticated instructor's
 * own tenant context (useAuthenticatedInstructorSession), never anything
 * derived from the route. A student id that doesn't belong to this tenant
 * simply 404s (TENANT_STUDENT_NOT_FOUND) rather than being trusted.
 */
export function StudentDetail({ studentId }: { studentId: string }) {
  const { tenant } = useAuthenticatedInstructorSession();
  const { t } = useI18n();
  const { state, retry } = useStudentDetail(tenant.tenantId, studentId);

  return (
    <div className="detail-page">
      <Link href="/instructor/students" className="back-link">
        <span className="back-arrow" aria-hidden="true" />
        {t("students.detailBack")}
      </Link>

      {state.status === "loading" ? (
        <p className="overview-loading" role="status">
          {t("overview.loading")}
        </p>
      ) : state.status === "error" ? (
        <div className="overview-error" role="alert">
          <p>
            {isNetworkError(state.error)
              ? t("shell.apiUnavailable")
              : t(resolveErrorMessageKey(state.error, "students.detailGenericError"))}
          </p>
          <button className="secondary-button compact-action" type="button" onClick={retry}>
            {t("shell.retry")}
          </button>
        </div>
      ) : (
        <>
          <header className="detail-header">
            <h2>{state.data.displayName ?? state.data.email}</h2>
            <span className={`status-badge status-badge-${state.data.status.toLowerCase()}`}>
              {t(STUDENT_STATUS_KEY[state.data.status])}
            </span>
          </header>

          <dl className="detail-grid">
            <div>
              <dt>{t("students.detailAccountLabel")}</dt>
              <dd>{state.data.email}</dd>
            </div>
            <div>
              <dt>{t("students.detailStatusLabel")}</dt>
              <dd>{t(STUDENT_STATUS_KEY[state.data.status])}</dd>
            </div>
            <div>
              <dt>{t("students.detailJoinedLabel")}</dt>
              <dd>{formatDate(state.data.createdAt)}</dd>
            </div>
            {state.data.activatedAt ? (
              <div>
                <dt>{t("students.detailActivatedLabel")}</dt>
                <dd>{formatDate(state.data.activatedAt)}</dd>
              </div>
            ) : null}
          </dl>

          <EnrollmentsSection tenantId={tenant.tenantId} studentUserId={state.data.userId} />
        </>
      )}
    </div>
  );
}
