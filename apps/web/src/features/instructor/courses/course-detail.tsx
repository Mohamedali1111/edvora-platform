"use client";

import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import { useAuthenticatedInstructorSession } from "@/features/instructor/session-context";
import { formatDate } from "@/features/instructor/students/format";
import { getAuthService } from "@/lib/api/session";
import { useI18n } from "@/lib/i18n/i18n";
import type { TranslationKey } from "@/lib/i18n/translations";
import type { CourseStatus, CourseSummary, CourseVisibility } from "@/lib/api/types";
import { updateCourse, useCourseDetail } from "./courses-service";
import { canArchive, canEditCourseMetadata, canPublish, isTerminal } from "./lifecycle";
import { LifecycleConfirmDialog } from "./lifecycle-confirm-dialog";
import { isCourseLifecycleConflict, isNetworkError, resolveErrorMessageKey } from "./error-mapping";
import { validateCourseInput } from "./validation";
import { SectionsPanel } from "./sections/sections-panel";

const COURSE_STATUS_KEY: Record<CourseStatus, TranslationKey> = {
  DRAFT: "status.courseDraft",
  PUBLISHED: "status.coursePublished",
  ARCHIVED: "status.courseArchived",
};

const VISIBILITY_KEY: Record<CourseVisibility, TranslationKey> = {
  PRIVATE: "courses.visibilityPrivate",
  ENROLLED_ONLY: "courses.visibilityEnrolledOnly",
};

/**
 * `courseId` (from the URL) only ever selects which course to display - the
 * tenant used for every request is always the authenticated instructor's
 * own tenant context, never anything derived from the route. A course id
 * that doesn't belong to this tenant simply 404s (COURSE_NOT_FOUND) rather
 * than being trusted.
 */
export function CourseDetail({ courseId }: { courseId: string }) {
  const { tenant } = useAuthenticatedInstructorSession();
  const { t } = useI18n();
  const { state, retry } = useCourseDetail(tenant.tenantId, courseId);

  return (
    <div className="detail-page">
      <Link href="/instructor/courses" className="back-link">
        <span className="back-arrow" aria-hidden="true" />
        {t("courses.detailBack")}
      </Link>

      {state.status === "loading" ? (
        <p className="overview-loading" role="status">
          {t("overview.loading")}
        </p>
      ) : state.status === "error" ? (
        <div className="overview-error" role="alert">
          <p>
            {isNetworkError(state.error) ? t("shell.apiUnavailable") : t(resolveErrorMessageKey(state.error, "courses.detailGenericError"))}
          </p>
          <button className="secondary-button compact-action" type="button" onClick={retry}>
            {t("shell.retry")}
          </button>
        </div>
      ) : (
        <CourseDetailBody tenantId={tenant.tenantId} course={state.data} onChanged={retry} />
      )}
    </div>
  );
}

function CourseDetailBody({ tenantId, course, onChanged }: { tenantId: string; course: CourseSummary; onChanged: () => void }) {
  const { t } = useI18n();
  const [lifecycleAction, setLifecycleAction] = useState<"publish" | "archive" | null>(null);
  const editable = canEditCourseMetadata(course.status);

  const [title, setTitle] = useState(course.title);
  const [description, setDescription] = useState(course.description ?? "");
  const [visibility, setVisibility] = useState<CourseVisibility>(course.visibility);
  const [trackedUpdatedAt, setTrackedUpdatedAt] = useState(course.updatedAt);
  const [errors, setErrors] = useState<{ title?: "required" | "tooLong"; description?: "tooLong" }>({});
  const [backendError, setBackendError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  // Re-sync the edit form to confirmed server state whenever the course was
  // actually written server-side (updatedAt changed) - during render, not an
  // effect (see react-hooks/set-state-in-effect; same pattern used
  // throughout this codebase). This never clobbers in-progress typing,
  // because updatedAt only changes after a real backend mutation. It's also
  // how a stale-conflict refetch (see saveMetadata's catch block) actually
  // takes visible effect: once the refetched course comes back ARCHIVED,
  // `editable` above is recomputed false and the form is replaced by the
  // read-only view on the very next render.
  if (trackedUpdatedAt !== course.updatedAt) {
    setTrackedUpdatedAt(course.updatedAt);
    setTitle(course.title);
    setDescription(course.description ?? "");
    setVisibility(course.visibility);
  }

  async function saveMetadata(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (savingRef.current) {
      return;
    }

    const nextErrors = validateCourseInput(title, description);
    setErrors(nextErrors);
    setBackendError(null);
    setSavedMessage(null);

    if (nextErrors.title || nextErrors.description) {
      return;
    }

    savingRef.current = true;
    setSaving(true);

    try {
      const trimmedDescription = description.trim();
      await updateCourse(getAuthService().getClient(), tenantId, course.courseId, {
        title: title.trim(),
        description: trimmedDescription ? trimmedDescription : null,
        visibility,
      });
      setSavedMessage(t("courses.saveSuccess"));
      onChanged();
    } catch (error) {
      if (isNetworkError(error)) {
        setBackendError(t("shell.apiUnavailable"));
      } else {
        setBackendError(t(resolveErrorMessageKey(error, "courses.saveErrorGeneric")));

        // The course was archived from under this page (another session, or this one via a
        // second tab) between load and submit. Refetch so the page transitions to the real,
        // current read-only state instead of leaving an editable form that would just fail
        // the same way again. The message above stays visible through that transition since
        // it's rendered outside the form/read-only branch below.
        if (isCourseLifecycleConflict(error)) {
          onChanged();
        }
      }
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <>
      <header className="detail-header">
        <h2>{course.title}</h2>
        <span className={`status-badge status-badge-${course.status.toLowerCase()}`}>{t(COURSE_STATUS_KEY[course.status])}</span>
      </header>

      {isTerminal(course.status) ? <div className="archived-banner">{t("courses.archivedReadOnlyBanner")}</div> : null}

      <dl className="detail-grid">
        <div>
          <dt>{t("courses.detailStatusLabel")}</dt>
          <dd>{t(COURSE_STATUS_KEY[course.status])}</dd>
        </div>
        <div>
          <dt>{t("courses.detailCreatedLabel")}</dt>
          <dd>{formatDate(course.createdAt)}</dd>
        </div>
        <div>
          <dt>{t("courses.detailUpdatedLabel")}</dt>
          <dd>{formatDate(course.updatedAt)}</dd>
        </div>
        {course.publishedAt ? (
          <div>
            <dt>{t("courses.detailPublishedLabel")}</dt>
            <dd>{formatDate(course.publishedAt)}</dd>
          </div>
        ) : null}
        {course.archivedAt ? (
          <div>
            <dt>{t("courses.detailArchivedLabel")}</dt>
            <dd>{formatDate(course.archivedAt)}</dd>
          </div>
        ) : null}
      </dl>

      <section className="detail-section" aria-labelledby="course-edit-heading">
        <div className="detail-section-header">
          <h2 id="course-edit-heading">{t("courses.editHeading")}</h2>
        </div>

        {savedMessage ? (
          <div className="form-success" role="status">
            {savedMessage}
          </div>
        ) : null}

        {backendError ? (
          <div className="form-error" role="alert">
            {backendError}
          </div>
        ) : null}

        {editable ? (
          <form className="auth-form" onSubmit={saveMetadata} noValidate>
            <div className="field">
              <label htmlFor="course-edit-title">{t("courses.titleLabel")}</label>
              <input
                id="course-edit-title"
                name="title"
                type="text"
                maxLength={240}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                aria-invalid={errors.title ? "true" : "false"}
                aria-describedby={errors.title ? "course-edit-title-error" : undefined}
              />
              {errors.title ? (
                <p className="field-error" id="course-edit-title-error">
                  {errors.title === "required" ? t("courses.titleRequired") : t("courses.titleTooLong")}
                </p>
              ) : null}
            </div>

            <div className="field">
              <label htmlFor="course-edit-description">{t("courses.descriptionLabel")}</label>
              <textarea
                id="course-edit-description"
                name="description"
                rows={4}
                maxLength={5000}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                aria-invalid={errors.description ? "true" : "false"}
                aria-describedby={errors.description ? "course-edit-description-error" : undefined}
              />
              {errors.description ? (
                <p className="field-error" id="course-edit-description-error">
                  {t("courses.descriptionTooLong")}
                </p>
              ) : null}
            </div>

            <div className="field">
              <label htmlFor="course-edit-visibility">{t("courses.visibilityLabel")}</label>
              <select
                id="course-edit-visibility"
                value={visibility}
                onChange={(event) => setVisibility(event.target.value as CourseVisibility)}
              >
                <option value="ENROLLED_ONLY">{t("courses.visibilityEnrolledOnly")}</option>
                <option value="PRIVATE">{t("courses.visibilityPrivate")}</option>
              </select>
            </div>

            <div className="modal-actions">
              <button className="primary-button compact-action" type="submit" disabled={saving}>
                {saving ? t("courses.saving") : t("courses.saveAction")}
              </button>
            </div>
          </form>
        ) : (
          <dl className="detail-grid">
            <div>
              <dt>{t("courses.titleLabel")}</dt>
              <dd>{course.title}</dd>
            </div>
            <div>
              <dt>{t("courses.descriptionLabel")}</dt>
              <dd>{course.description || t("courses.descriptionEmptyNote")}</dd>
            </div>
            <div>
              <dt>{t("courses.visibilityLabel")}</dt>
              <dd>{t(VISIBILITY_KEY[course.visibility])}</dd>
            </div>
          </dl>
        )}
      </section>

      {isTerminal(course.status) ? null : (
        <section className="detail-section" aria-labelledby="course-lifecycle-heading">
          <div className="detail-section-header">
            <h2 id="course-lifecycle-heading">{t("courses.lifecycleHeading")}</h2>
          </div>

          <div className="modal-actions course-lifecycle-actions">
            {canPublish(course.status) ? (
              <button className="primary-button compact-action" type="button" onClick={() => setLifecycleAction("publish")}>
                {t("courses.publishAction")}
              </button>
            ) : null}
            {canArchive(course.status) ? (
              <button className="secondary-button compact-action" type="button" onClick={() => setLifecycleAction("archive")}>
                {t("courses.archiveAction")}
              </button>
            ) : null}
          </div>
        </section>
      )}

      <section className="detail-section" aria-labelledby="course-sections-heading">
        <div className="detail-section-header">
          <h2 id="course-sections-heading">{t("courses.sectionsHeading")}</h2>
        </div>
        <SectionsPanel tenantId={tenantId} courseId={course.courseId} />
      </section>

      {lifecycleAction ? (
        <LifecycleConfirmDialog
          action={lifecycleAction}
          tenantId={tenantId}
          course={course}
          onClose={() => setLifecycleAction(null)}
          onDone={() => {
            setLifecycleAction(null);
            onChanged();
          }}
          onConflict={onChanged}
        />
      ) : null}
    </>
  );
}
