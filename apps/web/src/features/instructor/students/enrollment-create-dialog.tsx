"use client";

import { useRef, useState, type FormEvent } from "react";
import { getAuthService } from "@/lib/api/session";
import { useI18n } from "@/lib/i18n/i18n";
import type { TranslationKey } from "@/lib/i18n/translations";
import type { CourseStatus, EnrollmentSummary } from "@/lib/api/types";
import { NavIcon } from "@/features/instructor/nav-icons";
import { Modal } from "./dialog";
import { COURSE_SELECTOR_PAGE_SIZE, createEnrollment, useCourseSelectorPage } from "./enrollments-service";
import { isNetworkError, resolveErrorMessageKey } from "./error-mapping";
import { canGoNext, canGoPrevious, nextOffset, previousOffset } from "./pagination";

const COURSE_STATUS_KEY: Record<CourseStatus, TranslationKey> = {
  DRAFT: "status.courseDraft",
  PUBLISHED: "status.coursePublished",
  ARCHIVED: "status.courseArchived",
};

export function EnrollmentCreateDialog({
  tenantId,
  studentUserId,
  onClose,
  onCreated,
}: {
  tenantId: string;
  studentUserId: string;
  onClose: () => void;
  onCreated: (result: EnrollmentSummary) => void;
}) {
  const { t } = useI18n();
  const [courseOffset, setCourseOffset] = useState(0);
  const [courseId, setCourseId] = useState<string | null>(null);
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [selectError, setSelectError] = useState(false);
  const [backendError, setBackendError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const { state: courseState, retry: retryCourses } = useCourseSelectorPage(tenantId, courseOffset, true);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (submittingRef.current) {
      return;
    }

    if (!courseId) {
      setSelectError(true);
      return;
    }

    setSelectError(false);
    setBackendError(null);
    submittingRef.current = true;
    setSubmitting(true);

    try {
      const result = await createEnrollment(getAuthService().getClient(), tenantId, {
        studentUserId,
        courseId,
        startsAt: startsAt ? startsAt : undefined,
        endsAt: endsAt ? endsAt : undefined,
      });
      onCreated(result);
    } catch (error) {
      if (isNetworkError(error)) {
        setBackendError(t("shell.apiUnavailable"));
      } else {
        setBackendError(t(resolveErrorMessageKey(error, "enrollments.createErrorGeneric")));
      }
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <Modal titleId="create-enrollment-title" onClose={onClose}>
      <form className="auth-form" onSubmit={submit} noValidate>
        <h2 id="create-enrollment-title">{t("enrollments.createDialogTitle")}</h2>
        <p className="form-note">{t("enrollments.createDialogCopy")}</p>

        <div className="field">
          <span id="course-selector-label">{t("enrollments.courseSelectorLabel")}</span>
          {courseState.status === "loading" ? (
            <p className="overview-loading" role="status">
              {t("overview.loading")}
            </p>
          ) : courseState.status === "error" ? (
            <div className="overview-unavailable">
              {isNetworkError(courseState.error) ? t("shell.apiUnavailable") : t("enrollments.courseSelectorErrorLoad")}{" "}
              <button className="ghost-button compact" type="button" onClick={retryCourses}>
                {t("shell.retry")}
              </button>
            </div>
          ) : courseState.data.items.length === 0 ? (
            <div className="empty-state empty-state-compact">
              <span className="empty-state-icon" aria-hidden="true">
                <NavIcon section="courses" />
              </span>
              <p>{t("enrollments.courseSelectorEmpty")}</p>
            </div>
          ) : (
            <>
              <ul className="course-selector-list" role="radiogroup" aria-labelledby="course-selector-label">
                {courseState.data.items.map((course) => (
                  <li key={course.courseId}>
                    <label className="course-selector-option">
                      <input
                        type="radio"
                        name="courseId"
                        value={course.courseId}
                        checked={courseId === course.courseId}
                        onChange={() => {
                          setCourseId(course.courseId);
                          setSelectError(false);
                        }}
                      />
                      <span className="course-selector-option-title">{course.title}</span>
                      <span className={`status-badge status-badge-${course.status.toLowerCase()}`}>
                        {t(COURSE_STATUS_KEY[course.status])}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
              <div className="course-selector-pagination">
                <span className="course-selector-page-label">
                  {t("enrollments.courseSelectorPageLabel").replace("{page}", String(courseOffset / COURSE_SELECTOR_PAGE_SIZE + 1))}
                </span>
                <div className="pagination-controls" aria-label={t("pagination.pageLabel")}>
                  <button
                    className="secondary-button compact"
                    type="button"
                    onClick={() => setCourseOffset((value) => previousOffset(value, COURSE_SELECTOR_PAGE_SIZE))}
                    disabled={!canGoPrevious(courseOffset)}
                  >
                    {t("pagination.previous")}
                  </button>
                  <button
                    className="secondary-button compact"
                    type="button"
                    onClick={() => setCourseOffset((value) => nextOffset(value, COURSE_SELECTOR_PAGE_SIZE))}
                    disabled={!canGoNext(courseState.data.hasMore)}
                  >
                    {t("pagination.next")}
                  </button>
                </div>
              </div>
              {courseState.data.hasMore ? <p className="course-selector-more-note">{t("enrollments.courseSelectorMoreNote")}</p> : null}
            </>
          )}
          {selectError ? (
            <p className="field-error" role="alert">
              {t("enrollments.selectCourseRequired")}
            </p>
          ) : null}
        </div>

        <div className="field">
          <label htmlFor="enrollment-starts-at">{t("enrollments.startsAtOptionalLabel")}</label>
          <input id="enrollment-starts-at" type="date" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} />
        </div>

        <div className="field">
          <label htmlFor="enrollment-ends-at">{t("enrollments.endsAtOptionalLabel")}</label>
          <input id="enrollment-ends-at" type="date" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} />
        </div>

        {backendError ? (
          <div className="form-error" role="alert">
            {backendError}
          </div>
        ) : null}

        <div className="modal-actions">
          <button className="secondary-button" type="button" onClick={onClose} disabled={submitting}>
            {t("common.cancel")}
          </button>
          <button className="primary-button" type="submit" disabled={submitting}>
            {submitting ? t("enrollments.createSubmitting") : t("enrollments.createSubmit")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
