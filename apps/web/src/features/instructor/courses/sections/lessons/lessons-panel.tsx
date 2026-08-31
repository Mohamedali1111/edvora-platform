"use client";

import { useState } from "react";
import { getAuthService } from "@/lib/api/session";
import { useI18n } from "@/lib/i18n/i18n";
import type { TranslationKey } from "@/lib/i18n/translations";
import type { LessonStatus, LessonSummary, LessonType } from "@/lib/api/types";
import { reorderLessons, useLessonsList } from "./lessons-service";
import { formatDateTime } from "./format";
import { canArchiveLesson, canEditLessonMetadata, canPublishLesson, canReorderLesson } from "./lifecycle";
import { moveEarlier, moveLater, reorderableLessonIds } from "./ordering";
import { isNetworkError, resolveErrorMessageKey } from "./error-mapping";
import { CreateLessonDialog } from "./create-lesson-dialog";
import { EditLessonDialog } from "./edit-lesson-dialog";
import { LessonLifecycleConfirmDialog } from "./lesson-lifecycle-confirm-dialog";

const LESSON_STATUS_KEY: Record<LessonStatus, TranslationKey> = {
  DRAFT: "lessons.statusDraft",
  PUBLISHED: "lessons.statusPublished",
  ARCHIVED: "lessons.statusArchived",
};

const LESSON_TYPE_KEY: Record<LessonType, TranslationKey> = {
  VIDEO: "lessons.typeVideo",
  DOCUMENT: "lessons.typeDocument",
  QUIZ: "lessons.typeQuiz",
};

type LifecycleTarget = { action: "publish" | "archive"; lesson: LessonSummary };

/**
 * A Lesson's editability/lifecycle actions depend only on its own status,
 * never the parent Section's or Course's - confirmed against the frozen
 * backend (no Section/Course-status check exists in any LessonService
 * method) and consistent with the same documented no-cascade design already
 * relied on for Sections. Readiness for publish (asset READY / quiz
 * PUBLISHED) is not predicted here - the list response doesn't expose it,
 * so it's surfaced honestly only if/when a publish attempt actually fails.
 */
export function LessonsPanel({ tenantId, courseId, sectionId }: { tenantId: string; courseId: string; sectionId: string }) {
  const { t } = useI18n();
  const { state, retry } = useLessonsList(tenantId, courseId, sectionId);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingLesson, setEditingLesson] = useState<LessonSummary | null>(null);
  const [lifecycleTarget, setLifecycleTarget] = useState<LifecycleTarget | null>(null);
  const [reordering, setReordering] = useState(false);
  const [reorderError, setReorderError] = useState<string | null>(null);

  async function handleMove(lesson: LessonSummary, direction: "earlier" | "later") {
    if (reordering || state.status !== "ready") {
      return;
    }

    const order = reorderableLessonIds(state.data);
    const next = direction === "earlier" ? moveEarlier(order, lesson.lessonId) : moveLater(order, lesson.lessonId);

    if (!next) {
      return;
    }

    setReordering(true);
    setReorderError(null);

    try {
      await reorderLessons(getAuthService().getClient(), tenantId, courseId, sectionId, next);
      retry();
    } catch (error) {
      if (isNetworkError(error)) {
        setReorderError(t("shell.apiUnavailable"));
      } else {
        setReorderError(t(resolveErrorMessageKey(error, "lessons.reorderErrorGeneric")));
      }
      retry();
    } finally {
      setReordering(false);
    }
  }

  return (
    <div className="lesson-panel">
      <div className="modal-actions">
        <button className="ghost-button compact" type="button" onClick={() => setCreateOpen(true)}>
          {t("lessons.createAction")}
        </button>
      </div>

      {reordering ? (
        <p className="overview-loading" role="status">
          {t("lessons.reordering")}
        </p>
      ) : null}
      {reorderError ? (
        <div className="form-error" role="alert">
          {reorderError}
        </div>
      ) : null}

      {state.status === "loading" ? (
        <p className="overview-loading" role="status">
          {t("overview.loading")}
        </p>
      ) : state.status === "error" ? (
        <div className="overview-error" role="alert">
          <p>{isNetworkError(state.error) ? t("shell.apiUnavailable") : t(resolveErrorMessageKey(state.error, "lessons.errorLoad"))}</p>
          <button className="secondary-button compact-action" type="button" onClick={retry}>
            {t("shell.retry")}
          </button>
        </div>
      ) : state.data.length === 0 ? (
        <p className="overview-empty">{t("lessons.empty")}</p>
      ) : (
        <ol className="lesson-list">
          {state.data.map((lesson) => {
            const order = reorderableLessonIds(state.data);
            const canMoveEarlier = canReorderLesson(lesson.status) && moveEarlier(order, lesson.lessonId) !== null;
            const canMoveLater = canReorderLesson(lesson.status) && moveLater(order, lesson.lessonId) !== null;

            return (
              <li className="lesson-row" key={lesson.lessonId}>
                <div className="lesson-row-main">
                  <div className="lesson-row-title-line">
                    <span className={`lesson-type-badge lesson-type-${lesson.type.toLowerCase()}`}>
                      {t(LESSON_TYPE_KEY[lesson.type])}
                    </span>
                    <strong>{lesson.title}</strong>
                  </div>
                  {lesson.description ? <span className="table-secondary-text">{lesson.description}</span> : null}
                  {lesson.availableFrom || lesson.availableUntil ? (
                    <span className="table-secondary-text">
                      {lesson.availableFrom ? `${t("lessons.availableFromLabel")}: ${formatDateTime(lesson.availableFrom)}` : null}
                      {lesson.availableFrom && lesson.availableUntil ? " · " : null}
                      {lesson.availableUntil ? `${t("lessons.availableUntilLabel")}: ${formatDateTime(lesson.availableUntil)}` : null}
                    </span>
                  ) : null}
                </div>

                <span className={`status-badge status-badge-${lesson.status.toLowerCase()}`}>
                  {t(LESSON_STATUS_KEY[lesson.status])}
                </span>

                <div className="section-row-actions">
                  {canReorderLesson(lesson.status) ? (
                    <>
                      <button
                        className="ghost-button compact"
                        type="button"
                        onClick={() => handleMove(lesson, "earlier")}
                        disabled={reordering || !canMoveEarlier}
                        aria-label={`${t("sections.moveEarlierAction")}: ${lesson.title}`}
                      >
                        {t("sections.moveEarlierAction")}
                      </button>
                      <button
                        className="ghost-button compact"
                        type="button"
                        onClick={() => handleMove(lesson, "later")}
                        disabled={reordering || !canMoveLater}
                        aria-label={`${t("sections.moveLaterAction")}: ${lesson.title}`}
                      >
                        {t("sections.moveLaterAction")}
                      </button>
                    </>
                  ) : null}

                  {canEditLessonMetadata(lesson.status) ? (
                    <button className="ghost-button compact" type="button" onClick={() => setEditingLesson(lesson)}>
                      {t("sections.editAction")}
                    </button>
                  ) : null}

                  {canPublishLesson(lesson.status) ? (
                    <button
                      className="secondary-button compact"
                      type="button"
                      onClick={() => setLifecycleTarget({ action: "publish", lesson })}
                    >
                      {t("courses.publishAction")}
                    </button>
                  ) : null}

                  {canArchiveLesson(lesson.status) ? (
                    <button
                      className="secondary-button compact"
                      type="button"
                      onClick={() => setLifecycleTarget({ action: "archive", lesson })}
                    >
                      {t("courses.archiveAction")}
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {createOpen ? (
        <CreateLessonDialog
          tenantId={tenantId}
          courseId={courseId}
          sectionId={sectionId}
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            setCreateOpen(false);
            retry();
          }}
        />
      ) : null}

      {editingLesson ? (
        <EditLessonDialog
          tenantId={tenantId}
          courseId={courseId}
          sectionId={sectionId}
          lesson={editingLesson}
          onClose={() => setEditingLesson(null)}
          onSaved={() => {
            setEditingLesson(null);
            retry();
          }}
          onConflict={retry}
        />
      ) : null}

      {lifecycleTarget ? (
        <LessonLifecycleConfirmDialog
          action={lifecycleTarget.action}
          tenantId={tenantId}
          courseId={courseId}
          sectionId={sectionId}
          lesson={lifecycleTarget.lesson}
          onClose={() => setLifecycleTarget(null)}
          onDone={() => {
            setLifecycleTarget(null);
            retry();
          }}
          onConflict={retry}
        />
      ) : null}
    </div>
  );
}
