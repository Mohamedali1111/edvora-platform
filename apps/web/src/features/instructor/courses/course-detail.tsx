"use client";

import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import { useAuthenticatedInstructorSession } from "@/features/instructor/session-context";
import { ActionMenu, type ActionMenuItem } from "@/features/instructor/action-menu";
import { formatDate } from "@/features/instructor/students/format";
import { getAuthService } from "@/lib/api/session";
import { useI18n } from "@/lib/i18n/i18n";
import type { TranslationKey } from "@/lib/i18n/translations";
import type { CourseStatus, CourseSummary, CourseVisibility, PublishSelectedResult } from "@/lib/api/types";
import { updateCourse, useCourseDetail } from "./courses-service";
import { canArchive, canEditCourseMetadata, canTakeOffline, isArchived } from "./lifecycle";
import { isFirstPublishEligible, resolveCourseHeaderPrimaryAction } from "./first-publish";
import { LifecycleConfirmDialog, type CourseLifecycleAction } from "./lifecycle-confirm-dialog";
import { FirstPublishReview } from "./first-publish-review";
import { groupIssuesByLessonId } from "./readiness-copy";
import { useCourseReadiness } from "./readiness-data";
import { ReadinessStrip } from "./readiness-strip";
import { isCourseLifecycleConflict, isNetworkError, resolveErrorMessageKey } from "./error-mapping";
import { validateCourseInput } from "./validation";
import { SectionsPanel } from "./sections/sections-panel";
import { useSectionsWithLessons } from "./sections/sections-service";

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
    <div className="detail-page course-builder">
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
  const [lifecycleAction, setLifecycleAction] = useState<CourseLifecycleAction | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [publishSuccessMessage, setPublishSuccessMessage] = useState<string | null>(null);
  const editable = canEditCourseMetadata(course.status);

  // Bumped after any in-page Chapter/Lesson create or lifecycle mutation -
  // the Readiness Strip re-fetches whenever this changes, so "what will
  // students see if I publish this?" tracks the instructor's own edits on
  // this page without polling. Quiz and Media are authored on their own
  // separate routes with no live cross-tab sync; navigating back to this
  // Course Detail route from elsewhere is a fresh mount of this whole
  // component tree, which already refetches everything on its own - the
  // only remaining gap is an edit made elsewhere *while this exact tab
  // stays open*, covered by the Readiness Strip's own manual Refresh
  // action instead.
  const [contentVersion, setContentVersion] = useState(0);
  const bumpContentVersion = () => setContentVersion((value) => value + 1);

  // Owned here, not inside SectionsPanel/LessonsPanel or the Readiness
  // Strip: the header's Chapter-count summary, the builder list itself, and
  // the per-Lesson content-readiness join all need the same Chapters+Lessons
  // and server Readiness data, so one fetch of each serves all three
  // instead of three separate ones.
  const { state: contentState, retry: retryContent } = useSectionsWithLessons(tenantId, course.courseId);
  const chapterCount = contentState.status === "ready" ? contentState.data.length : null;
  const hasChapters = chapterCount !== null && chapterCount > 0;

  const { state: readinessState, retry: retryReadiness } = useCourseReadiness(tenantId, course.courseId, contentVersion);
  const readinessBlockersByLessonId =
    readinessState.status === "ready" ? groupIssuesByLessonId(readinessState.data.blockers) : undefined;

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

  const primaryAction = resolveCourseHeaderPrimaryAction(course);

  function headerOverflowItems(): ActionMenuItem[] {
    const items: ActionMenuItem[] = [];

    if (canTakeOffline(course.status)) {
      items.push({ key: "takeOffline", label: t("courses.takeOfflineAction"), onSelect: () => setLifecycleAction("takeOffline") });
    }

    if (canArchive(course.status)) {
      items.push({ key: "archive", label: t("courses.archiveAction"), danger: true, onSelect: () => setLifecycleAction("archive") });
    }

    return items;
  }

  const overflowItems = headerOverflowItems();

  return (
    <>
      <header className="course-builder-header">
        <div className="course-builder-header-main">
          <div className="course-builder-header-titleline">
            <h2>{course.title}</h2>
            <span className={`status-badge status-badge-${course.status.toLowerCase()}`}>{t(COURSE_STATUS_KEY[course.status])}</span>
          </div>
          {course.description ? <p className="page-subtitle course-builder-description">{course.description}</p> : null}
          {hasChapters ? <p className="form-note">{t("courses.chapterCountSummary").replace("{count}", String(chapterCount))}</p> : null}
        </div>

        <div className="course-builder-header-actions">
          {primaryAction === "reviewAndPublish" ? (
            <button className="primary-button compact-action" type="button" onClick={() => setReviewOpen(true)}>
              {t("courses.reviewAndPublishAction")}
            </button>
          ) : null}
          {primaryAction === "makeLiveAgain" ? (
            <button className="primary-button compact-action" type="button" onClick={() => setLifecycleAction("publish")}>
              {t("courses.makeLiveAgainAction")}
            </button>
          ) : null}
          {primaryAction === "restore" ? (
            <button className="primary-button compact-action" type="button" onClick={() => setLifecycleAction("restore")}>
              {t("courses.restoreAction")}
            </button>
          ) : null}
          {overflowItems.length > 0 ? (
            <ActionMenu label={t("common.moreActionsFor").replace("{item}", course.title)} items={overflowItems} />
          ) : null}
        </div>
      </header>

      {isArchived(course.status) ? <div className="archived-banner">{t("courses.archivedReadOnlyBanner")}</div> : null}

      {publishSuccessMessage ? (
        <div className="form-success" role="status">
          {publishSuccessMessage}
        </div>
      ) : null}

      {!isArchived(course.status) && hasChapters ? (
        <ReadinessStrip
          state={readinessState}
          mode={isFirstPublishEligible(course) ? "firstPublish" : "contentHealth"}
          onRefresh={retryReadiness}
          onReviewAndPublish={() => setReviewOpen(true)}
        />
      ) : null}

      <section className="detail-section course-builder-content" aria-labelledby="course-chapters-heading">
        <div className="detail-section-header">
          <h2 id="course-chapters-heading">{t("courses.sectionsHeading")}</h2>
        </div>
        <SectionsPanel
          tenantId={tenantId}
          courseId={course.courseId}
          state={contentState}
          onRetry={retryContent}
          readinessBlockersByLessonId={readinessBlockersByLessonId}
          onContentChanged={() => {
            bumpContentVersion();
            retryReadiness();
          }}
        />
      </section>

      <section className="detail-section course-settings-section" aria-labelledby="course-edit-heading">
        <div className="detail-section-header">
          <h2 id="course-edit-heading">{t("courses.editHeading")}</h2>
        </div>

        <dl className="detail-grid course-settings-meta">
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

      {reviewOpen ? (
        <FirstPublishReview
          tenantId={tenantId}
          course={course}
          onClose={() => setReviewOpen(false)}
          onPublished={(result: PublishSelectedResult) => {
            setReviewOpen(false);
            setPublishSuccessMessage(t("courses.publishReviewSuccess").replace("{count}", String(result.published.lessonIds.length)));
            bumpContentVersion();
            retryContent();
            retryReadiness();
            onChanged();
          }}
        />
      ) : null}
    </>
  );
}
