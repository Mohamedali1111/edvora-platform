"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n/i18n";
import type { TranslationKey } from "@/lib/i18n/translations";
import type { EnrollmentStatus, InstructorEnrollmentSummary } from "@/lib/api/types";
import { NavIcon } from "@/features/instructor/nav-icons";
import { ENROLLMENTS_PAGE_SIZE, useStudentEnrollments } from "./enrollments-service";
import { EnrollmentCreateDialog } from "./enrollment-create-dialog";
import { RevokeEnrollmentDialog } from "./revoke-enrollment-dialog";
import { isNetworkError } from "./error-mapping";
import { formatDate } from "./format";
import { canGoNext, canGoPrevious, nextOffset, previousOffset } from "./pagination";

const ENROLLMENT_STATUS_KEY: Record<EnrollmentStatus, TranslationKey> = {
  ACTIVE: "enrollments.statusActive",
  INACTIVE: "enrollments.statusInactive",
  REVOKED: "enrollments.statusRevoked",
  EXPIRED: "enrollments.statusExpired",
};

const STATUS_FILTER_OPTIONS: Array<EnrollmentStatus | "ALL"> = ["ALL", "ACTIVE", "INACTIVE", "REVOKED", "EXPIRED"];

/**
 * Enrollments for exactly one student - the frozen backend requires a
 * courseId or studentUserId filter on the list endpoint, and scoping to the
 * student being viewed is also the natural UX fit. The status dropdown is a
 * real backend query param (re-fetches), never a client-side filter over an
 * already-fetched page.
 */
export function EnrollmentsSection({
  tenantId,
  studentUserId,
}: {
  tenantId: string;
  studentUserId: string;
}) {
  const { t } = useI18n();
  const [offset, setOffset] = useState(0);
  const [statusFilter, setStatusFilter] = useState<EnrollmentStatus | "ALL">("ALL");
  const [createOpen, setCreateOpen] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<InstructorEnrollmentSummary | null>(null);

  const { state, retry } = useStudentEnrollments(tenantId, studentUserId, offset, statusFilter === "ALL" ? undefined : statusFilter);

  function handleFilterChange(value: EnrollmentStatus | "ALL") {
    setStatusFilter(value);
    setOffset(0);
  }

  return (
    <section className="detail-section enrollments-section" aria-labelledby="enrollments-heading">
      <div className="detail-section-header">
        <h2 id="enrollments-heading">{t("enrollments.heading")}</h2>
        <button className="primary-button compact-action" type="button" onClick={() => setCreateOpen(true)}>
          {t("students.detailEnrollAction")}
        </button>
      </div>

      <div className="field enrollment-filter">
        <label htmlFor="enrollment-status-filter">{t("enrollments.statusFilterLabel")}</label>
        <select
          id="enrollment-status-filter"
          value={statusFilter}
          onChange={(event) => handleFilterChange(event.target.value as EnrollmentStatus | "ALL")}
        >
          {STATUS_FILTER_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option === "ALL" ? t("enrollments.statusAll") : t(ENROLLMENT_STATUS_KEY[option])}
            </option>
          ))}
        </select>
      </div>

      {state.status === "loading" ? (
        <p className="overview-loading" role="status">
          {t("overview.loading")}
        </p>
      ) : state.status === "error" ? (
        <div className="overview-error" role="alert">
          <p>{isNetworkError(state.error) ? t("shell.apiUnavailable") : t("enrollments.errorLoad")}</p>
          <button className="secondary-button compact-action" type="button" onClick={retry}>
            {t("shell.retry")}
          </button>
        </div>
      ) : state.data.items.length === 0 ? (
        <div className="empty-state">
          <span className="empty-state-icon" aria-hidden="true">
            <NavIcon section="courses" />
          </span>
          <p>{t("enrollments.empty")}</p>
        </div>
      ) : (
        <>
          <div className="table-scroll">
            <table className="data-table enrollments-table">
              <caption className="sr-only">{t("enrollments.heading")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("enrollments.columnCourse")}</th>
                  <th scope="col">{t("enrollments.columnStatus")}</th>
                  <th scope="col" className="table-col-secondary">
                    {t("enrollments.columnDates")}
                  </th>
                  <th scope="col">
                    <span className="sr-only">{t("enrollments.columnActions")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {state.data.items.map((enrollment) => (
                  <tr key={enrollment.enrollmentId}>
                    <td data-label={t("enrollments.columnCourse")}>{enrollment.courseTitle}</td>
                    <td data-label={t("enrollments.columnStatus")}>
                      <span className={`status-badge status-badge-enrollment-${enrollment.status.toLowerCase()}`}>
                        {t(ENROLLMENT_STATUS_KEY[enrollment.status])}
                      </span>
                      {enrollment.currentlyEffective ? (
                        <span className="status-badge status-badge-effective">{t("enrollments.currentlyEffective")}</span>
                      ) : null}
                    </td>
                    <td className="table-col-secondary" data-label={t("enrollments.columnDates")}>
                      {enrollment.startsAt || enrollment.endsAt ? (
                        <span className="enrollment-dates">
                          {enrollment.startsAt ? (
                            <span>
                              {t("enrollments.startsAtLabel")}: {formatDate(enrollment.startsAt)}
                            </span>
                          ) : null}
                          {enrollment.endsAt ? (
                            <span>
                              {t("enrollments.endsAtLabel")}: {formatDate(enrollment.endsAt)}
                            </span>
                          ) : null}
                        </span>
                      ) : (
                        t("enrollments.datesNone")
                      )}
                      {enrollment.status === "REVOKED" && enrollment.revokedAt ? (
                        <span className="enrollment-dates enrollment-revoked-at">
                          {t("enrollments.revokedAtLabel")}: {formatDate(enrollment.revokedAt)}
                        </span>
                      ) : null}
                    </td>
                    <td data-label={t("enrollments.columnActions")}>
                      {enrollment.status === "ACTIVE" ? (
                        <button className="ghost-button compact" type="button" onClick={() => setRevokeTarget(enrollment)}>
                          {t("enrollments.revokeAction")}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="pagination-controls" aria-label={t("pagination.pageLabel")}>
            <button
              className="secondary-button compact"
              type="button"
              onClick={() => setOffset((value) => previousOffset(value, ENROLLMENTS_PAGE_SIZE))}
              disabled={!canGoPrevious(offset)}
            >
              {t("pagination.previous")}
            </button>
            <button
              className="secondary-button compact"
              type="button"
              onClick={() => setOffset((value) => nextOffset(value, ENROLLMENTS_PAGE_SIZE))}
              disabled={!canGoNext(state.data.hasMore)}
            >
              {t("pagination.next")}
            </button>
          </div>
        </>
      )}

      {createOpen ? (
        <EnrollmentCreateDialog
          tenantId={tenantId}
          studentUserId={studentUserId}
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            setCreateOpen(false);
            setOffset(0);
            retry();
          }}
        />
      ) : null}

      {revokeTarget ? (
        <RevokeEnrollmentDialog
          tenantId={tenantId}
          enrollmentId={revokeTarget.enrollmentId}
          courseTitle={revokeTarget.courseTitle}
          onClose={() => setRevokeTarget(null)}
          onRevoked={() => {
            setRevokeTarget(null);
            retry();
          }}
        />
      ) : null}
    </section>
  );
}
