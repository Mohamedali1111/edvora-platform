"use client";

import Link from "next/link";
import { useState } from "react";
import { useAuthenticatedInstructorSession } from "@/features/instructor/session-context";
import { NavIcon } from "@/features/instructor/nav-icons";
import { formatDate } from "@/features/instructor/students/format";
import { canGoNext, canGoPrevious, nextOffset, previousOffset } from "@/features/instructor/students/pagination";
import { useI18n } from "@/lib/i18n/i18n";
import type { TranslationKey } from "@/lib/i18n/translations";
import type { CourseStatus } from "@/lib/api/types";
import { CreateCourseDialog } from "./create-course-dialog";
import { COURSES_PAGE_SIZE, useCoursesList } from "./courses-service";
import { isNetworkError } from "./error-mapping";

const COURSE_STATUS_KEY: Record<CourseStatus, TranslationKey> = {
  DRAFT: "status.courseDraft",
  PUBLISHED: "status.coursePublished",
  ARCHIVED: "status.courseArchived",
};

export function CoursesList() {
  const { tenant } = useAuthenticatedInstructorSession();
  const { t } = useI18n();
  const [offset, setOffset] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const { state, retry } = useCoursesList(tenant.tenantId, offset);

  return (
    <div className="courses-page">
      <div className="page-header">
        <div>
          <h2>{t("nav.courses")}</h2>
          <p className="page-subtitle">{t("courses.subtitle")}</p>
        </div>
        <button className="primary-button" type="button" onClick={() => setCreateOpen(true)}>
          {t("courses.createAction")}
        </button>
      </div>

      {state.status === "loading" ? (
        <p className="overview-loading" role="status">
          {t("overview.loading")}
        </p>
      ) : state.status === "error" ? (
        <div className="overview-error" role="alert">
          <p>{isNetworkError(state.error) ? t("shell.apiUnavailable") : t("courses.errorLoad")}</p>
          <button className="secondary-button compact-action" type="button" onClick={retry}>
            {t("shell.retry")}
          </button>
        </div>
      ) : state.data.items.length === 0 ? (
        <div className="empty-state">
          <span className="empty-state-icon" aria-hidden="true">
            <NavIcon section="courses" />
          </span>
          <p>{t("courses.empty")}</p>
        </div>
      ) : (
        <>
          <div className="table-scroll">
            <table className="data-table courses-table">
              <caption className="sr-only">{t("nav.courses")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("courses.columnTitle")}</th>
                  <th scope="col">{t("courses.columnStatus")}</th>
                  <th scope="col" className="table-col-secondary">
                    {t("courses.columnUpdated")}
                  </th>
                  <th scope="col">
                    <span className="sr-only">{t("courses.columnActions")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {state.data.items.map((course) => (
                  <tr key={course.courseId}>
                    <td data-label={t("courses.columnTitle")}>
                      <strong>{course.title}</strong>
                    </td>
                    <td data-label={t("courses.columnStatus")}>
                      <span className={`status-badge status-badge-${course.status.toLowerCase()}`}>
                        {t(COURSE_STATUS_KEY[course.status])}
                      </span>
                    </td>
                    <td className="table-col-secondary" data-label={t("courses.columnUpdated")}>
                      {formatDate(course.updatedAt)}
                    </td>
                    <td data-label={t("courses.columnActions")}>
                      <Link
                        className="ghost-button compact row-link"
                        href={`/instructor/courses/${course.courseId}`}
                        aria-label={t("courses.viewActionLabel").replace("{course}", course.title)}
                      >
                        {t("courses.viewAction")}
                        <span className="row-link-arrow" aria-hidden="true" />
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
              onClick={() => setOffset((value) => previousOffset(value, COURSES_PAGE_SIZE))}
              disabled={!canGoPrevious(offset)}
            >
              {t("pagination.previous")}
            </button>
            <button
              className="secondary-button compact"
              type="button"
              onClick={() => setOffset((value) => nextOffset(value, COURSES_PAGE_SIZE))}
              disabled={!canGoNext(state.data.hasMore)}
            >
              {t("pagination.next")}
            </button>
          </div>
        </>
      )}

      {createOpen ? <CreateCourseDialog tenantId={tenant.tenantId} onClose={() => setCreateOpen(false)} /> : null}
    </div>
  );
}
