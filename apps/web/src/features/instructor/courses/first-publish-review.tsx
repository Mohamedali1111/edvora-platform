"use client";

import { useEffect, useRef, useState } from "react";
import { Modal } from "@/features/instructor/students/dialog";
import { getAuthService } from "@/lib/api/session";
import { useI18n } from "@/lib/i18n/i18n";
import type { TranslationKey } from "@/lib/i18n/translations";
import type { CourseReadiness, CourseSectionSummary, CourseSummary, LessonType, PublishSelectedResult } from "@/lib/api/types";
import { getCourseReadiness, publishSelected } from "./courses-service";
import { isNetworkError, isPublishSelectionStale, resolveErrorMessageKey } from "./error-mapping";
import { readinessIssueMessage } from "./readiness-copy";
import { LessonTypeIcon } from "./sections/lessons/add-lesson/lesson-type-icons";
import {
  buildPublishSelectedRequest,
  defaultSelectedLessonIds,
  formatPublishSummary,
  groupLessonsBySection,
  isSelectionValid,
  toggleLessonSelected,
} from "./publish-selection";
import { listSections } from "./sections/sections-service";

const LESSON_TYPE_KEY: Record<LessonType, TranslationKey> = {
  VIDEO: "lessons.typeVideo",
  DOCUMENT: "lessons.typeDocument",
  QUIZ: "lessons.typeQuiz",
};

type LoadedData = { sections: CourseSectionSummary[]; readiness: CourseReadiness };

type LoadState = { status: "loading" } | { status: "ready"; data: LoadedData } | { status: "error"; error: unknown };

/**
 * The mandatory First-Publish Review flow (product review Parts 6-9) for a
 * Course where `status === DRAFT && publishedAt === null`. Never calls the
 * plain `/publish` - only `POST .../publish-selected` (DEC-0050), and only
 * with exactly the Chapters/Lessons the instructor explicitly reviewed here.
 *
 * Fetches its own fresh Sections + server Readiness on mount rather than
 * trusting whatever the Course Builder page happened to have loaded when
 * "Review & publish" was clicked - review is a deliberate, occasional
 * action, not a hot path, so one extra fetch to guarantee it always starts
 * from provably-current state is the right trade, and it reuses the exact
 * same fetch for the stale-selection re-review below (`reload`).
 *
 * The instructor only ever checks/unchecks *Lessons* (see publish-selection.ts) -
 * a selected Lesson's Chapter is always mechanically derived (already
 * included if it's Draft, never required if it's already Live), so the
 * "Chapter must be selected too, unless already Live" rule can never be
 * violated by the UI, and there is nothing resembling a fake disabled
 * Chapter checkbox to get wrong.
 */
export function FirstPublishReview({
  tenantId,
  course,
  onClose,
  onPublished,
}: {
  tenantId: string;
  course: CourseSummary;
  onClose: () => void;
  onPublished: (result: PublishSelectedResult) => void;
}) {
  const { t } = useI18n();
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [selectedLessonIds, setSelectedLessonIds] = useState<Set<string>>(new Set());
  const [staleMessage, setStaleMessage] = useState<string | null>(null);
  const [backendError, setBackendError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);

  // Same "bump an attempt counter, reset to loading during render" idiom
  // used by every other fetch hook in this feature (e.g. courses-service.ts's
  // useCourseDetail) - deliberately not a directly-invoked `async function
  // load()` called from inside the effect: setState reached that way (even
  // after an await) trips react-hooks/set-state-in-effect, which only
  // tolerates setState from a promise `.then()/.catch()` callback chained
  // directly in the effect body, as below.
  const [attempt, setAttempt] = useState(0);
  const [trackedAttempt, setTrackedAttempt] = useState(attempt);
  const reload = () => setAttempt((value) => value + 1);

  if (trackedAttempt !== attempt) {
    setTrackedAttempt(attempt);
    setLoadState({ status: "loading" });
  }

  useEffect(() => {
    let cancelled = false;
    const client = getAuthService().getClient();

    Promise.all([listSections(client, tenantId, course.courseId), getCourseReadiness(client, tenantId, course.courseId)])
      .then(([sectionsResponse, readiness]) => {
        if (cancelled) {
          return;
        }
        setLoadState({ status: "ready", data: { sections: sectionsResponse.items, readiness } });
        setSelectedLessonIds(defaultSelectedLessonIds(readiness.readyToPublish));
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLoadState({ status: "error", error });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [tenantId, course.courseId, attempt]);

  function toggleLesson(lessonId: string) {
    setSelectedLessonIds((current) => toggleLessonSelected(current, lessonId));
  }

  async function submit(data: LoadedData) {
    if (submittingRef.current) {
      return;
    }

    const liveSectionIds = new Set(data.sections.filter((section) => section.status === "PUBLISHED").map((section) => section.sectionId));
    const request = buildPublishSelectedRequest(selectedLessonIds, data.readiness.readyToPublish.lessons, liveSectionIds);

    if (!isSelectionValid(selectedLessonIds)) {
      return;
    }

    setBackendError(null);
    submittingRef.current = true;
    setSubmitting(true);

    try {
      const client = getAuthService().getClient();
      const result = await publishSelected(client, tenantId, course.courseId, request);
      onPublished(result);
    } catch (error) {
      if (isNetworkError(error)) {
        setBackendError(t("shell.apiUnavailable"));
      } else if (isPublishSelectionStale(error)) {
        // Expected concurrency behavior, not a crash: the Course changed
        // under the instructor while they were reviewing it. Explain that
        // plainly, then reload Sections/Readiness so the Chapter/Lesson
        // grid and "Needs attention" list below immediately reflect the
        // newly relevant issues - never auto-retry the mutation itself.
        setStaleMessage(t("courses.publishReviewStaleExplain"));
        reload();
      } else {
        setBackendError(t(resolveErrorMessageKey(error, "courses.publishReviewErrorGeneric")));
      }
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <Modal titleId="first-publish-review-title" onClose={onClose} size="wide">
      <div className="publish-review">
        <header className="publish-review-header">
          <h2 id="first-publish-review-title">{t("courses.publishReviewTitle")}</h2>
          <p className="form-note">{course.title}</p>
          <p className="form-note">{t("courses.publishReviewExplain")}</p>
        </header>

        {loadState.status === "loading" ? (
          <p className="overview-loading" role="status">
            {t("overview.loading")}
          </p>
        ) : loadState.status === "error" ? (
          <div className="overview-error" role="alert">
            <p>{isNetworkError(loadState.error) ? t("shell.apiUnavailable") : t("courses.publishReviewLoadError")}</p>
            <button className="secondary-button compact-action" type="button" onClick={reload}>
              {t("shell.retry")}
            </button>
          </div>
        ) : (
          <ReviewBody
            data={loadState.data}
            selectedLessonIds={selectedLessonIds}
            onToggleLesson={toggleLesson}
            staleMessage={staleMessage}
            backendError={backendError}
            submitting={submitting}
            onCancel={onClose}
            onSubmit={() => void submit(loadState.data)}
          />
        )}
      </div>
    </Modal>
  );
}

function ReviewBody({
  data,
  selectedLessonIds,
  onToggleLesson,
  staleMessage,
  backendError,
  submitting,
  onCancel,
  onSubmit,
}: {
  data: LoadedData;
  selectedLessonIds: ReadonlySet<string>;
  onToggleLesson: (lessonId: string) => void;
  staleMessage: string | null;
  backendError: string | null;
  submitting: boolean;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const { t, locale } = useI18n();
  const { sections, readiness } = data;
  const liveSectionIds = new Set(sections.filter((section) => section.status === "PUBLISHED").map((section) => section.sectionId));
  const sectionsById = new Map(sections.map((section) => [section.sectionId, section] as const));
  const chapterGroups = groupLessonsBySection(readiness.readyToPublish.lessons);
  const request = buildPublishSelectedRequest(selectedLessonIds, readiness.readyToPublish.lessons, liveSectionIds);
  const valid = isSelectionValid(selectedLessonIds);
  const summaryText = formatPublishSummary(selectedLessonIds.size, request.sectionIds.length, locale);

  return (
    <>
      {staleMessage ? (
        <div className="form-error publish-review-stale" role="alert">
          {staleMessage}
        </div>
      ) : null}

      {backendError && !staleMessage ? (
        <div className="form-error" role="alert">
          {backendError}
        </div>
      ) : null}

      <div className="publish-review-body">
        {chapterGroups.length === 0 ? (
          <p className="overview-empty">{t("courses.publishReviewNothingReady")}</p>
        ) : (
          chapterGroups.map((group) => {
            const section = sectionsById.get(group.sectionId);
            const isLive = section?.status === "PUBLISHED";
            const headingId = `publish-review-chapter-${group.sectionId}`;

            return (
              <section className="publish-review-chapter" key={group.sectionId} aria-labelledby={headingId}>
                <h3 id={headingId} className="publish-review-chapter-heading">
                  {section?.title ?? group.lessons[0]?.title ?? ""}
                  {isLive ? (
                    <span className="status-badge status-badge-published">{t("status.coursePublished")}</span>
                  ) : (
                    <span className="form-note publish-review-chapter-note">{t("courses.publishReviewChapterWillPublish")}</span>
                  )}
                </h3>
                <ul className="publish-review-lesson-list">
                  {group.lessons.map((lesson) => {
                    const lessonIssues = readiness.blockers.filter((issue) => issue.parentLessonId === lesson.lessonId);
                    return (
                      <li key={lesson.lessonId}>
                        <label className="publish-review-lesson-option">
                          <input type="checkbox" checked={selectedLessonIds.has(lesson.lessonId)} onChange={() => onToggleLesson(lesson.lessonId)} />
                          <span className="publish-review-lesson-info">
                            <span className={`lesson-type-badge lesson-type-${lesson.type.toLowerCase()}`}>
                              <LessonTypeIcon type={lesson.type} size={14} />
                              {t(LESSON_TYPE_KEY[lesson.type])}
                            </span>
                            <strong>{lesson.title}</strong>
                            {lessonIssues.length > 0 ? (
                              <span className="table-secondary-text">{readinessIssueMessage(lessonIssues[0], t)}</span>
                            ) : null}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })
        )}

        {readiness.blockers.length > 0 ? (
          <section className="publish-review-issues" aria-labelledby="publish-review-issues-heading">
            <h3 id="publish-review-issues-heading">{t("courses.publishReviewIssuesHeading")}</h3>
            <ul className="course-readiness-list">
              {readiness.blockers.map((issue, index) => (
                <li key={`${issue.entityType}-${issue.entityId}-${index}`}>{readinessIssueMessage(issue, t)}</li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>

      <footer className="publish-review-footer">
        <p className="form-note" role="status">
          {valid ? summaryText : t("courses.publishReviewSelectAtLeastOne")}
        </p>
        <div className="modal-actions">
          <button className="secondary-button" type="button" onClick={onCancel} disabled={submitting}>
            {t("common.cancel")}
          </button>
          <button className="primary-button" type="button" onClick={onSubmit} disabled={submitting || !valid}>
            {submitting ? t("courses.publishReviewPublishing") : t("courses.publishReviewPublishAction")}
          </button>
        </div>
      </footer>
    </>
  );
}
