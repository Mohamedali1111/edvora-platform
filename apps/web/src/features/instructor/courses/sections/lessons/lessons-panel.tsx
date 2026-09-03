"use client";

import { useState } from "react";
import { getAuthService } from "@/lib/api/session";
import { useI18n } from "@/lib/i18n/i18n";
import type { TranslationKey } from "@/lib/i18n/translations";
import type { LessonStatus, LessonSummary, LessonType, ReadinessIssue } from "@/lib/api/types";
import { NavIcon } from "@/features/instructor/nav-icons";
import { ActionMenu, type ActionMenuItem } from "@/features/instructor/action-menu";
import { LessonTypeIcon } from "./add-lesson/lesson-type-icons";
import { reorderLessons } from "./lessons-service";
import { formatDateTime } from "./format";
import { canArchiveLesson, canEditLessonMetadata, canPublishLesson, canReorderLesson, canRestoreLesson, canTakeLessonOffline } from "./lifecycle";
import { moveEarlier, moveLater, reorderableLessonIds } from "./ordering";
import { isNetworkError, resolveErrorMessageKey } from "./error-mapping";
import { lessonContentReadiness } from "@/features/instructor/courses/readiness-copy";
import { CreateLessonDialog } from "./create-lesson-dialog";
import { EditLessonDialog } from "./edit-lesson-dialog";
import { LessonLifecycleConfirmDialog, type LessonLifecycleAction } from "./lesson-lifecycle-confirm-dialog";

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

const CONTENT_READINESS_KEY: Record<"processing" | "needsAttention" | "failed", TranslationKey> = {
  processing: "lessons.assetStatusProcessing",
  needsAttention: "lessons.contentNeedsAttention",
  failed: "lessons.assetStatusFailed",
};

type LifecycleTarget = { action: LessonLifecycleAction; lesson: LessonSummary };

/**
 * A Lesson's editability/lifecycle actions depend only on its own status,
 * never the parent Chapter's or Course's - confirmed against the backend
 * (no Section/Course-status check exists in any LessonService method) and
 * consistent with the same documented no-cascade design already relied on
 * for Chapters. Data (`lessons`) is owned by the Course Builder page
 * (course-detail.tsx via `useSectionsWithLessons`, threaded through
 * `SectionsPanel`) - this component is presentational for data, still
 * owning its own create/edit/lifecycle dialog and reorder-pending UI state.
 *
 * Row shape: Edit is the primary action (a Lesson has no nested content to
 * reveal the way a Chapter does, so there's no natural row/expand primary -
 * editing its content is the obvious next step). Move up/down, Publish,
 * Hide from students, Archive, and Restore all live in the overflow menu.
 * A content-readiness badge (Processing/Needs attention/Failed) appears
 * next to a Draft Lesson's status only when the server's own readiness
 * blockers report an issue for it - never a raw provider/processing code.
 */
export function LessonsPanel({
  tenantId,
  courseId,
  sectionId,
  lessons,
  readinessBlockersByLessonId,
  onRefresh,
  onContentChanged,
}: {
  tenantId: string;
  courseId: string;
  sectionId: string;
  lessons: LessonSummary[];
  readinessBlockersByLessonId: ReadonlyMap<string, ReadinessIssue[]> | undefined;
  /** Re-fetches the whole Chapter/Lesson tree (SectionsPanel's `onRetry`) - the source of `lessons` above, so every mutation here goes through the parent rather than keeping a second, locally-fetched copy. */
  onRefresh: () => void;
  /**
   * Called after a Lesson create or lifecycle (publish/take offline/
   * archive/restore) change - see `SectionsPanel`'s equivalent prop, which
   * forwards this straight through from course-detail.tsx's
   * `bumpContentVersion`. A newly created Lesson is also this product's
   * only "content attachment" event (the backend requires the
   * videoAssetId/documentAssetId/quizId at creation time - there is no
   * separate later attach step), so `onCreated` alone already covers that
   * case too.
   */
  onContentChanged: () => void;
}) {
  const { t } = useI18n();
  const [createOpen, setCreateOpen] = useState(false);
  const [editingLesson, setEditingLesson] = useState<LessonSummary | null>(null);
  const [lifecycleTarget, setLifecycleTarget] = useState<LifecycleTarget | null>(null);
  const [reordering, setReordering] = useState(false);
  const [reorderError, setReorderError] = useState<string | null>(null);

  async function handleMove(lesson: LessonSummary, direction: "earlier" | "later") {
    if (reordering) {
      return;
    }

    const order = reorderableLessonIds(lessons);
    const next = direction === "earlier" ? moveEarlier(order, lesson.lessonId) : moveLater(order, lesson.lessonId);

    if (!next) {
      return;
    }

    setReordering(true);
    setReorderError(null);

    try {
      await reorderLessons(getAuthService().getClient(), tenantId, courseId, sectionId, next);
      onRefresh();
    } catch (error) {
      if (isNetworkError(error)) {
        setReorderError(t("shell.apiUnavailable"));
      } else {
        setReorderError(t(resolveErrorMessageKey(error, "lessons.reorderErrorGeneric")));
      }
      onRefresh();
    } finally {
      setReordering(false);
    }
  }

  function lessonActions(lesson: LessonSummary, order: string[]): ActionMenuItem[] {
    const items: ActionMenuItem[] = [];

    if (canReorderLesson(lesson.status)) {
      const canMoveEarlier = moveEarlier(order, lesson.lessonId) !== null;
      const canMoveLater = moveLater(order, lesson.lessonId) !== null;

      items.push({
        key: "move-earlier",
        label: t("sections.moveEarlierAction"),
        disabled: !canMoveEarlier,
        disabledReason: canMoveEarlier ? undefined : t("common.alreadyFirst"),
        onSelect: () => void handleMove(lesson, "earlier"),
      });
      items.push({
        key: "move-later",
        label: t("sections.moveLaterAction"),
        disabled: !canMoveLater,
        disabledReason: canMoveLater ? undefined : t("common.alreadyLast"),
        onSelect: () => void handleMove(lesson, "later"),
      });
    }

    if (canPublishLesson(lesson.status)) {
      items.push({ key: "publish", label: t("courses.publishAction"), onSelect: () => setLifecycleTarget({ action: "publish", lesson }) });
    }

    if (canTakeLessonOffline(lesson.status)) {
      items.push({
        key: "takeOffline",
        label: t("courses.takeOfflineAction"),
        onSelect: () => setLifecycleTarget({ action: "takeOffline", lesson }),
      });
    }

    if (canArchiveLesson(lesson.status)) {
      items.push({
        key: "archive",
        label: t("courses.archiveAction"),
        danger: true,
        onSelect: () => setLifecycleTarget({ action: "archive", lesson }),
      });
    }

    if (canRestoreLesson(lesson.status)) {
      items.push({ key: "restore", label: t("courses.restoreAction"), onSelect: () => setLifecycleTarget({ action: "restore", lesson }) });
    }

    return items;
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

      {lessons.length === 0 ? (
        <div className="empty-state">
          <span className="empty-state-icon" aria-hidden="true">
            <NavIcon section="courses" />
          </span>
          <p>{t("lessons.empty")}</p>
        </div>
      ) : (
        <ol className="lesson-list">
          {lessons.map((lesson) => {
            const order = reorderableLessonIds(lessons);
            const contentReadiness =
              lesson.status === "DRAFT" ? lessonContentReadiness(readinessBlockersByLessonId?.get(lesson.lessonId) ?? []) : null;

            return (
              <li className="lesson-row" key={lesson.lessonId}>
                <div className="lesson-row-main">
                  <div className="lesson-row-title-line">
                    <span className={`lesson-type-badge lesson-type-${lesson.type.toLowerCase()}`}>
                      <LessonTypeIcon type={lesson.type} size={14} />
                      {t(LESSON_TYPE_KEY[lesson.type])}
                    </span>
                    <strong>{lesson.title}</strong>
                  </div>
                  {lesson.description ? <span className="table-secondary-text">{lesson.description}</span> : null}
                  {lesson.availableFrom || lesson.availableUntil ? (
                    <span className="table-secondary-text">
                      {lesson.availableFrom ? `${t("lessons.availableFromDisplayLabel")}: ${formatDateTime(lesson.availableFrom)}` : null}
                      {lesson.availableFrom && lesson.availableUntil ? " · " : null}
                      {lesson.availableUntil ? `${t("lessons.availableUntilDisplayLabel")}: ${formatDateTime(lesson.availableUntil)}` : null}
                    </span>
                  ) : null}
                </div>

                <span className="lesson-row-status">
                  <span className={`status-badge status-badge-${lesson.status.toLowerCase()}`}>{t(LESSON_STATUS_KEY[lesson.status])}</span>
                  {contentReadiness ? (
                    <span className={`status-badge status-badge-content-${contentReadiness}`}>{t(CONTENT_READINESS_KEY[contentReadiness])}</span>
                  ) : null}
                </span>

                <div className="row-actions">
                  {canEditLessonMetadata(lesson.status) ? (
                    <button className="ghost-button compact" type="button" onClick={() => setEditingLesson(lesson)}>
                      {t("sections.editAction")}
                    </button>
                  ) : null}
                  <ActionMenu label={t("common.moreActionsFor").replace("{item}", lesson.title)} items={lessonActions(lesson, order)} />
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
            onRefresh();
            onContentChanged();
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
            onRefresh();
          }}
          onConflict={onRefresh}
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
            onRefresh();
            onContentChanged();
          }}
          onConflict={onRefresh}
        />
      ) : null}
    </div>
  );
}
