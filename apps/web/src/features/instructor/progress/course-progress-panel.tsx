"use client";

import { useState } from "react";
import { useAuthenticatedInstructorSession } from "@/features/instructor/session-context";
import { canGoNext, canGoPrevious, nextOffset, previousOffset } from "@/features/instructor/students/pagination";
import type { CourseStatus, EnrollmentStatus } from "@/lib/api/types";
import { useI18n } from "@/lib/i18n/i18n";
import type { TranslationKey } from "@/lib/i18n/translations";
import { EntityPicker } from "./entity-picker";
import { isNetworkError } from "./error-mapping";
import { formatDateTime, formatProgressPercent } from "./format";
import { PROGRESS_PAGE_SIZE, ENTITY_PICKER_PAGE_SIZE, useCoursePicker, useCourseProgress } from "./progress-service";

const COURSE_STATUS_KEY: Record<CourseStatus, TranslationKey> = {
  DRAFT: "status.courseDraft",
  PUBLISHED: "status.coursePublished",
  ARCHIVED: "status.courseArchived",
};

const ENROLLMENT_STATUS_KEY: Record<EnrollmentStatus, TranslationKey> = {
  ACTIVE: "enrollments.statusActive",
  INACTIVE: "enrollments.statusInactive",
  REVOKED: "enrollments.statusRevoked",
  EXPIRED: "enrollments.statusExpired",
};

const STATUS_FILTER_OPTIONS: Array<EnrollmentStatus | "ALL"> = ["ALL", "ACTIVE", "INACTIVE", "REVOKED", "EXPIRED"];

/**
 * Student/Course Progress reporting - Slice G. Read-only: renders exactly
 * the fields `GET .../courses/:courseId/progress` returns, with no derived
 * statistic the backend didn't compute (no study hours, streaks, ranking).
 */
export function CourseProgressPanel() {
  const { tenant } = useAuthenticatedInstructorSession();
  const { t } = useI18n();
  const [selectedCourse, setSelectedCourse] = useState<{ courseId: string; title: string; status: CourseStatus } | null>(null);
  const [pickerOpen, setPickerOpen] = useState(true);
  const [pickerOffset, setPickerOffset] = useState(0);
  const [statusFilter, setStatusFilter] = useState<EnrollmentStatus | "ALL">("ALL");
  const [offset, setOffset] = useState(0);

  const { state: pickerState, retry: retryPicker } = useCoursePicker(tenant.tenantId, pickerOffset, pickerOpen);
  const { state, retry } = useCourseProgress(tenant.tenantId, selectedCourse?.courseId ?? null, statusFilter === "ALL" ? undefined : statusFilter, offset);

  function handleStatusChange(value: EnrollmentStatus | "ALL") {
    setStatusFilter(value);
    setOffset(0);
  }

  return (
    <div className="progress-panel">
      <div className="field">
        <span id="progress-course-picker-label">{t("progress.courseLabel")}</span>

        {!pickerOpen && selectedCourse ? (
          <div className="entity-chip">
            <span className="entity-chip-title">{selectedCourse.title}</span>
            <span className={`status-badge status-badge-${selectedCourse.status.toLowerCase()}`}>{t(COURSE_STATUS_KEY[selectedCourse.status])}</span>
            <button
              className="ghost-button compact"
              type="button"
              onClick={() => setPickerOpen(true)}
              aria-label={t("progress.changeCourseLabel").replace("{course}", selectedCourse.title)}
            >
              {t("progress.changeAction")}
            </button>
          </div>
        ) : (
          <EntityPicker
            labelId="progress-course-picker-label"
            state={pickerState}
            retry={retryPicker}
            offset={pickerOffset}
            onOffsetChange={setPickerOffset}
            pageSize={ENTITY_PICKER_PAGE_SIZE}
            getId={(course) => course.courseId}
            selectedId={selectedCourse?.courseId ?? null}
            onSelect={(course) => {
              setSelectedCourse({ courseId: course.courseId, title: course.title, status: course.status });
              setPickerOpen(false);
              setOffset(0);
            }}
            loadingErrorFallback="progress.pickerErrorLoad"
            emptyLabel="progress.courseSelectorEmpty"
            renderOption={(course) => (
              <>
                <span>{course.title}</span>
                <span className={`status-badge status-badge-${course.status.toLowerCase()}`}>{t(COURSE_STATUS_KEY[course.status])}</span>
              </>
            )}
          />
        )}
      </div>

      {!selectedCourse ? (
        <p className="overview-empty">{t("progress.noCourseSelected")}</p>
      ) : (
        <>
          <div className="field enrollment-filter">
            <label htmlFor="progress-status-filter">{t("enrollments.statusFilterLabel")}</label>
            <select id="progress-status-filter" value={statusFilter} onChange={(event) => handleStatusChange(event.target.value as EnrollmentStatus | "ALL")}>
              {STATUS_FILTER_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option === "ALL" ? t("enrollments.statusAll") : t(ENROLLMENT_STATUS_KEY[option])}
                </option>
              ))}
            </select>
          </div>

          {state.status === "idle" || state.status === "loading" ? (
            <p className="overview-loading" role="status">
              {t("overview.loading")}
            </p>
          ) : state.status === "error" ? (
            <div className="overview-error" role="alert">
              <p>{isNetworkError(state.error) ? t("shell.apiUnavailable") : t("progress.errorLoad")}</p>
              <button className="secondary-button compact-action" type="button" onClick={retry}>
                {t("shell.retry")}
              </button>
            </div>
          ) : state.data.items.length === 0 ? (
            <p className="overview-empty">{t("progress.empty")}</p>
          ) : (
            <>
              <div className="table-scroll">
                <table className="data-table">
                  <caption className="sr-only">{t("progress.tabProgress")}</caption>
                  <thead>
                    <tr>
                      <th scope="col">{t("progress.columnStudent")}</th>
                      <th scope="col">{t("progress.columnStatus")}</th>
                      <th scope="col">{t("progress.columnProgress")}</th>
                      <th scope="col" className="table-col-secondary">
                        {t("progress.columnEnrollmentWindow")}
                      </th>
                      <th scope="col" className="table-col-secondary">
                        {t("progress.columnLastActivity")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.data.items.map((row) => (
                      <tr key={row.enrollmentId}>
                        <td>
                          <strong>{row.student.displayName ?? row.student.email}</strong>
                          {row.student.displayName ? <span className="table-secondary-text">{row.student.email}</span> : null}
                        </td>
                        <td>
                          <span className={`status-badge status-badge-enrollment-${row.status.toLowerCase()}`}>{t(ENROLLMENT_STATUS_KEY[row.status])}</span>
                          {row.currentlyEffective ? <span className="status-badge status-badge-effective">{t("enrollments.currentlyEffective")}</span> : null}
                        </td>
                        <td>
                          <span className="progress-percent">{formatProgressPercent(row.progressPercent)}</span>
                          <span className="table-secondary-text">
                            {row.totalLessons === 0
                              ? t("progress.noLessons")
                              : t("progress.lessonsCompleted").replace("{completed}", String(row.completedLessons)).replace("{total}", String(row.totalLessons))}
                          </span>
                        </td>
                        <td className="table-col-secondary">
                          <span className="enrollment-dates">
                            <span>
                              {t("enrollments.startsAtLabel")}: {row.startsAt ? formatDateTime(row.startsAt, "") : t("progress.noStartDate")}
                            </span>
                            <span>
                              {t("enrollments.endsAtLabel")}: {row.endsAt ? formatDateTime(row.endsAt, "") : t("progress.noEndDate")}
                            </span>
                          </span>
                        </td>
                        <td className="table-col-secondary">{formatDateTime(row.lastActivityAt, t("progress.activityNone"))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="pagination-controls" aria-label={t("pagination.pageLabel")}>
                <button className="secondary-button compact" type="button" onClick={() => setOffset((value) => previousOffset(value, PROGRESS_PAGE_SIZE))} disabled={!canGoPrevious(offset)}>
                  {t("pagination.previous")}
                </button>
                <button className="secondary-button compact" type="button" onClick={() => setOffset((value) => nextOffset(value, PROGRESS_PAGE_SIZE))} disabled={!canGoNext(state.data.hasMore)}>
                  {t("pagination.next")}
                </button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
