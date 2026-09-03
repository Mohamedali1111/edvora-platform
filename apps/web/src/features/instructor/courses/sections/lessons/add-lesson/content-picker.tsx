"use client";

import { useState } from "react";
import { formatDate } from "@/features/instructor/students/format";
import { canGoNext, canGoPrevious, nextOffset, previousOffset } from "@/features/instructor/students/pagination";
import { useI18n } from "@/lib/i18n/i18n";
import type { TranslationKey } from "@/lib/i18n/translations";
import type { AssetProcessingStatus, DocumentAssetSummary, LessonType, QuizStatus, QuizSummary, VideoAssetSummary } from "@/lib/api/types";
import { CONTENT_PICKER_PAGE_SIZE, useContentSelectionPage, type ContentOptionItem } from "../lessons-service";
import { formatDuration } from "../format";
import { isNetworkError } from "../error-mapping";

const CONTENT_PICKER_EMPTY_TITLE_KEY: Record<LessonType, TranslationKey> = {
  VIDEO: "lessons.noVideosAvailable",
  DOCUMENT: "lessons.noDocumentsAvailable",
  QUIZ: "lessons.noQuizzesAvailable",
};

const CONTENT_PICKER_EMPTY_ACTION_KEY: Record<LessonType, TranslationKey> = {
  VIDEO: "lessons.emptyPickerUploadVideoAction",
  DOCUMENT: "lessons.emptyPickerUploadDocumentAction",
  QUIZ: "lessons.emptyPickerCreateQuizAction",
};

const ASSET_STATUS_KEY: Record<AssetProcessingStatus, TranslationKey> = {
  UPLOADING: "lessons.assetStatusUploading",
  PROCESSING: "lessons.assetStatusProcessing",
  READY: "lessons.assetStatusReady",
  FAILED: "lessons.assetStatusFailed",
  ARCHIVED: "lessons.assetStatusArchived",
};

const QUIZ_STATUS_KEY: Record<QuizStatus, TranslationKey> = {
  DRAFT: "lessons.quizStatusDraft",
  PUBLISHED: "lessons.quizStatusPublished",
  ARCHIVED: "lessons.quizStatusArchived",
};

/**
 * The "choose existing" side of the Add Lesson content step - the frozen
 * backend still requires exactly one already-existing videoAssetId/
 * documentAssetId/quizId at Lesson creation, so this only ever lets the
 * instructor select a real, already-existing, bounded/paginated asset or
 * Quiz (same `useContentSelectionPage` this feature already used). The one
 * behavior change from the previous, dialog-only version of this list is
 * the empty state: instead of a dead end, it offers a primary action that
 * switches the surrounding Add Lesson step straight into the matching
 * "create new" flow (`onSwitchToCreate`) - Part 4 of the redesign.
 */
export function ContentPicker({
  type,
  tenantId,
  selectedId,
  onSelect,
  onSwitchToCreate,
}: {
  type: LessonType;
  tenantId: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onSwitchToCreate: () => void;
}) {
  const { t } = useI18n();
  const [offset, setOffset] = useState(0);
  const { state, retry } = useContentSelectionPage(tenantId, type, offset);

  return (
    <div className="field">
      {state.status === "loading" ? (
        <p className="overview-loading" role="status">
          {t("overview.loading")}
        </p>
      ) : state.status === "error" ? (
        <div className="overview-unavailable">
          {isNetworkError(state.error) ? t("shell.apiUnavailable") : t("lessons.contentLoadError")}{" "}
          <button className="ghost-button compact" type="button" onClick={retry}>
            {t("shell.retry")}
          </button>
        </div>
      ) : state.data.items.length === 0 ? (
        <div className="empty-state-action">
          <p>{t(CONTENT_PICKER_EMPTY_TITLE_KEY[type])}</p>
          <button className="primary-button compact-action" type="button" onClick={onSwitchToCreate}>
            {t(CONTENT_PICKER_EMPTY_ACTION_KEY[type])}
          </button>
        </div>
      ) : (
        <>
          <ul className="course-selector-list" role="radiogroup" aria-label={t("lessons.selectExistingContentLabel")}>
            {state.data.items.map((item) => (
              <ContentOptionRow
                key={contentOptionId(type, item)}
                type={type}
                item={item}
                selected={selectedId === contentOptionId(type, item)}
                onSelect={() => onSelect(contentOptionId(type, item))}
              />
            ))}
          </ul>
          <div className="course-selector-pagination">
            <span className="course-selector-page-label">
              {t("lessons.contentPickerPageLabel").replace("{page}", String(offset / CONTENT_PICKER_PAGE_SIZE + 1))}
            </span>
            <div className="pagination-controls" aria-label={t("pagination.pageLabel")}>
              <button
                className="secondary-button compact"
                type="button"
                onClick={() => setOffset((value) => previousOffset(value, CONTENT_PICKER_PAGE_SIZE))}
                disabled={!canGoPrevious(offset)}
              >
                {t("pagination.previous")}
              </button>
              <button
                className="secondary-button compact"
                type="button"
                onClick={() => setOffset((value) => nextOffset(value, CONTENT_PICKER_PAGE_SIZE))}
                disabled={!canGoNext(state.data.hasMore)}
              >
                {t("pagination.next")}
              </button>
            </div>
          </div>
          {state.data.hasMore ? <p className="course-selector-more-note">{t("lessons.contentPickerMoreNote")}</p> : null}
        </>
      )}
    </div>
  );
}

function contentOptionId(type: LessonType, item: ContentOptionItem): string {
  if (type === "VIDEO") {
    return (item as VideoAssetSummary).videoAssetId;
  }

  if (type === "DOCUMENT") {
    return (item as DocumentAssetSummary).documentAssetId;
  }

  return (item as QuizSummary).quizId;
}

function ContentOptionRow({
  type,
  item,
  selected,
  onSelect,
}: {
  type: LessonType;
  item: ContentOptionItem;
  selected: boolean;
  onSelect: () => void;
}) {
  const { t } = useI18n();

  if (type === "VIDEO") {
    const video = item as VideoAssetSummary;
    return (
      <li>
        <label className="course-selector-option">
          <input type="radio" name="lessonContent" checked={selected} onChange={onSelect} />
          <span>
            {video.durationSeconds != null ? formatDuration(video.durationSeconds) : t("lessons.durationUnknown")} ·{" "}
            {formatDate(video.createdAt)}
          </span>
          <span className={`status-badge status-badge-${video.processingStatus.toLowerCase()}`}>
            {t(ASSET_STATUS_KEY[video.processingStatus])}
          </span>
        </label>
      </li>
    );
  }

  if (type === "DOCUMENT") {
    const document_ = item as DocumentAssetSummary;
    return (
      <li>
        <label className="course-selector-option">
          <input type="radio" name="lessonContent" checked={selected} onChange={onSelect} />
          <span>{document_.fileName}</span>
          <span className={`status-badge status-badge-${document_.processingStatus.toLowerCase()}`}>
            {t(ASSET_STATUS_KEY[document_.processingStatus])}
          </span>
        </label>
      </li>
    );
  }

  const quiz = item as QuizSummary;
  return (
    <li>
      <label className="course-selector-option">
        <input type="radio" name="lessonContent" checked={selected} onChange={onSelect} />
        <span>{quiz.title}</span>
        <span className={`status-badge status-badge-${quiz.status.toLowerCase()}`}>{t(QUIZ_STATUS_KEY[quiz.status])}</span>
      </label>
    </li>
  );
}
