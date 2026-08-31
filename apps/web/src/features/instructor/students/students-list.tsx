"use client";

import Link from "next/link";
import { useState } from "react";
import { useAuthenticatedInstructorSession } from "@/features/instructor/session-context";
import { useI18n } from "@/lib/i18n/i18n";
import type { TranslationKey } from "@/lib/i18n/translations";
import type { AddTenantStudentResult, TenantStudentStatus } from "@/lib/api/types";
import { AddStudentDialog } from "./add-student-dialog";
import { STUDENTS_PAGE_SIZE, useStudentsList } from "./students-service";
import { isNetworkError } from "./error-mapping";
import { formatDate } from "./format";
import { canGoNext, canGoPrevious, nextOffset, previousOffset } from "./pagination";

const STUDENT_STATUS_KEY: Record<TenantStudentStatus, TranslationKey> = {
  ACTIVE: "status.studentActive",
  INACTIVE: "status.studentInactive",
  REMOVED: "status.studentRemoved",
};

export function StudentsList() {
  const { tenant } = useAuthenticatedInstructorSession();
  const { t } = useI18n();
  const [offset, setOffset] = useState(0);
  const [addOpen, setAddOpen] = useState(false);
  const [addedMessage, setAddedMessage] = useState<string | null>(null);
  const { state, retry } = useStudentsList(tenant.tenantId, offset);

  // Called only after the instructor has already seen (and dismissed) the
  // one-time activation handoff inside AddStudentDialog - this only ever
  // reads the boolean shape of `result.activation`, never `.rawToken`.
  function handleAdded(result: AddTenantStudentResult) {
    setAddOpen(false);
    setAddedMessage(result.activation ? t("students.addSuccessNewAccount") : t("students.addSuccess"));
    setOffset(0);
    retry();
  }

  return (
    <div className="students-page">
      <div className="page-header">
        <div>
          <h2>{t("nav.students")}</h2>
          <p className="page-subtitle">{t("students.subtitle")}</p>
        </div>
        <button className="primary-button" type="button" onClick={() => setAddOpen(true)}>
          {t("students.addAction")}
        </button>
      </div>

      {addedMessage ? (
        <div className="form-success" role="status">
          {addedMessage}
        </div>
      ) : null}

      {state.status === "loading" ? (
        <p className="overview-loading" role="status">
          {t("overview.loading")}
        </p>
      ) : state.status === "error" ? (
        <div className="overview-error" role="alert">
          <p>{isNetworkError(state.error) ? t("shell.apiUnavailable") : t("students.errorLoad")}</p>
          <button className="secondary-button compact-action" type="button" onClick={retry}>
            {t("shell.retry")}
          </button>
        </div>
      ) : state.data.items.length === 0 ? (
        <p className="overview-empty">{t("students.empty")}</p>
      ) : (
        <>
          <div className="table-scroll">
            <table className="data-table">
              <caption className="sr-only">{t("nav.students")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("students.columnStudent")}</th>
                  <th scope="col">{t("students.columnStatus")}</th>
                  <th scope="col" className="table-col-secondary">
                    {t("students.columnJoined")}
                  </th>
                  <th scope="col">
                    <span className="sr-only">{t("students.columnActions")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {state.data.items.map((student) => (
                  <tr key={student.associationId}>
                    <td>
                      <strong>{student.displayName ?? student.email}</strong>
                      {student.displayName ? <span className="table-secondary-text">{student.email}</span> : null}
                    </td>
                    <td>
                      <span className={`status-badge status-badge-${student.status.toLowerCase()}`}>
                        {t(STUDENT_STATUS_KEY[student.status])}
                      </span>
                    </td>
                    <td className="table-col-secondary">{formatDate(student.createdAt)}</td>
                    <td>
                      <Link className="ghost-button compact" href={`/instructor/students/${student.userId}`}>
                        {t("students.viewAction")}
                      </Link>
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
              onClick={() => setOffset((value) => previousOffset(value, STUDENTS_PAGE_SIZE))}
              disabled={!canGoPrevious(offset)}
            >
              {t("pagination.previous")}
            </button>
            <button
              className="secondary-button compact"
              type="button"
              onClick={() => setOffset((value) => nextOffset(value, STUDENTS_PAGE_SIZE))}
              disabled={!canGoNext(state.data.hasMore)}
            >
              {t("pagination.next")}
            </button>
          </div>
        </>
      )}

      {addOpen ? <AddStudentDialog tenantId={tenant.tenantId} onClose={() => setAddOpen(false)} onAdded={handleAdded} /> : null}
    </div>
  );
}
