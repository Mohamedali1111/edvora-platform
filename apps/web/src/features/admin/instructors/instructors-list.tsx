"use client";

import Link from "next/link";
import { useState } from "react";
import { useI18n } from "@/lib/i18n/i18n";
import type { CreatedInstructorResult } from "@/lib/api/types";
import { AdminNavIcon } from "../nav-icons";
import { formatDate } from "../format";
import { canGoNext, canGoPrevious, nextOffset, previousOffset } from "../pagination";
import { INSTRUCTOR_ACTIVATION_STATE_KEY } from "./activation";
import { CreateInstructorDialog } from "./create-instructor-dialog";
import { INSTRUCTORS_PAGE_SIZE, useInstructorsList } from "./instructors-service";
import { isNetworkError } from "./error-mapping";

/**
 * Instructor + Tenant onboarding management. Every field rendered here is
 * exactly what `GET /admin/instructors` returns - one Instructor and the
 * one Tenant/Academy they own, since the backend's own query only ever
 * returns OWNER-membership rows (see InstructorOnboardingService.listInstructors).
 */
export function InstructorsList() {
  const { t } = useI18n();
  const [offset, setOffset] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const { state, retry } = useInstructorsList(offset);

  function handleCreated(result: CreatedInstructorResult) {
    setCreateOpen(false);
    setSuccessMessage(`${t("admin.instructors.createSuccess")} ${result.tenantName}`);
    setOffset(0);
    retry();
  }

  return (
    <div className="admin-page">
      <div className="page-header">
        <div>
          <h2>{t("admin.nav.instructors")}</h2>
          <p className="page-subtitle">{t("admin.instructors.subtitle")}</p>
        </div>
        <button className="primary-button" type="button" onClick={() => setCreateOpen(true)}>
          {t("admin.instructors.createAction")}
        </button>
      </div>

      {successMessage ? (
        <div className="form-success" role="status">
          {successMessage}
        </div>
      ) : null}

      {state.status === "loading" ? (
        <p className="admin-overview-loading" role="status">
          {t("admin.instructors.loading")}
        </p>
      ) : state.status === "error" ? (
        <div className="admin-overview-error" role="alert">
          <p>{isNetworkError(state.error) ? t("admin.shell.apiUnavailable") : t("admin.instructors.errorLoad")}</p>
          <button className="secondary-button compact-action" type="button" onClick={retry}>
            {t("admin.shell.retry")}
          </button>
        </div>
      ) : state.data.items.length === 0 ? (
        <div className="admin-empty-state">
          <span className="admin-empty-state-icon" aria-hidden="true">
            <AdminNavIcon section="instructors" />
          </span>
          <p>{t("admin.instructors.empty")}</p>
        </div>
      ) : (
        <>
          <div className="table-scroll">
            <table className="data-table instructors-table">
              <caption className="sr-only">{t("admin.nav.instructors")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("admin.instructors.columnInstructor")}</th>
                  <th scope="col">{t("admin.instructors.columnTenant")}</th>
                  <th scope="col">{t("admin.instructors.columnStatus")}</th>
                  <th scope="col">{t("admin.instructors.columnActivation")}</th>
                  <th scope="col" className="table-col-secondary">
                    {t("admin.instructors.columnCreatedAt")}
                  </th>
                  <th scope="col">
                    <span className="sr-only">{t("admin.instructors.columnActions")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {state.data.items.map((instructor) => {
                  const name = instructor.displayName ?? instructor.email;
                  return (
                    <tr key={instructor.userId}>
                      <td data-label={t("admin.instructors.columnInstructor")}>
                        <strong>{name}</strong>
                        {instructor.displayName ? <span className="table-secondary-text">{instructor.email}</span> : null}
                      </td>
                      <td data-label={t("admin.instructors.columnTenant")}>{instructor.tenantName}</td>
                      <td data-label={t("admin.instructors.columnStatus")}>
                        <span className={`status-badge status-badge-${instructor.accountStatus.toLowerCase()}`}>
                          {instructor.accountStatus}
                        </span>
                      </td>
                      <td data-label={t("admin.instructors.columnActivation")}>
                        <span className={`status-badge status-badge-${instructor.activationState.toLowerCase()}`}>
                          {t(INSTRUCTOR_ACTIVATION_STATE_KEY[instructor.activationState])}
                        </span>
                      </td>
                      <td className="table-col-secondary" data-label={t("admin.instructors.columnCreatedAt")}>
                        {formatDate(instructor.createdAt)}
                      </td>
                      <td data-label={t("admin.instructors.columnActions")}>
                        <Link
                          className="ghost-button compact admin-row-link"
                          href={`/admin/instructors/${instructor.userId}`}
                          aria-label={t("admin.instructors.viewActionLabel").replace("{instructor}", name)}
                        >
                          {t("admin.instructors.viewAction")}
                          <span className="admin-card-arrow" aria-hidden="true" />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="pagination-controls" aria-label={t("pagination.pageLabel")}>
            <button
              className="secondary-button compact"
              type="button"
              onClick={() => setOffset((value) => previousOffset(value, INSTRUCTORS_PAGE_SIZE))}
              disabled={!canGoPrevious(offset)}
            >
              {t("pagination.previous")}
            </button>
            <button
              className="secondary-button compact"
              type="button"
              onClick={() => setOffset((value) => nextOffset(value, INSTRUCTORS_PAGE_SIZE))}
              disabled={!canGoNext(state.data.hasMore)}
            >
              {t("pagination.next")}
            </button>
          </div>
        </>
      )}

      {createOpen ? <CreateInstructorDialog onClose={() => setCreateOpen(false)} onCreated={handleCreated} /> : null}
    </div>
  );
}
