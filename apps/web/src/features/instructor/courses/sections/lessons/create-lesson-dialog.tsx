"use client";

import { useRef, useState, type FormEvent } from "react";
import { NavIcon } from "@/features/instructor/nav-icons";
import type { InstructorSection } from "@/features/instructor/navigation";
import { Modal } from "@/features/instructor/students/dialog";
import { formatDate } from "@/features/instructor/students/format";
import { canGoNext, canGoPrevious, nextOffset, previousOffset } from "@/features/instructor/students/pagination";
// Lesson title/description constraints are identical to Course/Section's (1-240 char
// title, <=5000 char description) - reusing the existing validator rather than
// duplicating an identical rule set for a third resource.
import { validateCourseInput } from "@/features/instructor/courses/validation";
import { getAuthService } from "@/lib/api/session";
import { useI18n } from "@/lib/i18n/i18n";
import type { TranslationKey } from "@/lib/i18n/translations";
import type {
  AssetProcessingStatus,
  DocumentAssetSummary,
  LessonSummary,
  LessonType,
  QuizStatus,
  QuizSummary,
  VideoAssetSummary,
} from "@/lib/api/types";
import { CONTENT_PICKER_PAGE_SIZE, createLesson, useContentSelectionPage, type ContentOptionItem } from "./lessons-service";
import { formatDuration, fromDateTimeLocalValue } from "./format";
import { isNetworkError, resolveErrorMessageKey } from "./error-mapping";

const LESSON_TYPE_KEY: Record<LessonType, TranslationKey> = {
  VIDEO: "lessons.typeVideo",
  DOCUMENT: "lessons.typeDocument",
  QUIZ: "lessons.typeQuiz",
};

const CONTENT_PICKER_LABEL_KEY: Record<LessonType, TranslationKey> = {
  VIDEO: "lessons.selectVideoLabel",
  DOCUMENT: "lessons.selectDocumentLabel",
  QUIZ: "lessons.selectQuizLabel",
};

const CONTENT_PICKER_EMPTY_KEY: Record<LessonType, TranslationKey> = {
  VIDEO: "lessons.noVideosAvailable",
  DOCUMENT: "lessons.noDocumentsAvailable",
  QUIZ: "lessons.noQuizzesAvailable",
};

const CONTENT_PICKER_ICON_SECTION: Record<LessonType, InstructorSection> = {
  VIDEO: "media",
  DOCUMENT: "media",
  QUIZ: "quizzes",
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
 * The frozen backend has no "create a lesson shell, bind content later"
 * workflow - exactly one already-existing videoAssetId/documentAssetId/
 * quizId must be supplied at creation, matching the chosen type. This
 * dialog only ever lets the instructor select from the real, already-
 * existing, bounded/paginated asset and quiz lists - it never uploads,
 * processes media, or authors a quiz (those remain deferred to their own
 * slices). Readiness (VideoAsset/DocumentAsset READY, Quiz PUBLISHED) is
 * shown per option using only real backend fields, but is not required to
 * select an item - the backend only enforces readiness at publish time, so
 * a not-yet-ready asset can still be picked now.
 */
export function CreateLessonDialog({
  tenantId,
  courseId,
  sectionId,
  onClose,
  onCreated,
}: {
  tenantId: string;
  courseId: string;
  sectionId: string;
  onClose: () => void;
  onCreated: (result: LessonSummary) => void;
}) {
  const { t } = useI18n();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<LessonType>("VIDEO");
  const [contentOffset, setContentOffset] = useState(0);
  const [selectedContentId, setSelectedContentId] = useState<string | null>(null);
  const [selectError, setSelectError] = useState(false);
  const [availableFrom, setAvailableFrom] = useState("");
  const [availableUntil, setAvailableUntil] = useState("");
  const [errors, setErrors] = useState<{ title?: "required" | "tooLong"; description?: "tooLong" }>({});
  const [backendError, setBackendError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const { state: contentState, retry: retryContent } = useContentSelectionPage(tenantId, type, contentOffset);

  function handleTypeChange(nextType: LessonType) {
    setType(nextType);
    setContentOffset(0);
    setSelectedContentId(null);
    setSelectError(false);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (submittingRef.current) {
      return;
    }

    const nextErrors = validateCourseInput(title, description);
    setErrors(nextErrors);
    setBackendError(null);
    const missingContent = !selectedContentId;
    setSelectError(missingContent);

    if (nextErrors.title || nextErrors.description || missingContent) {
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);

    try {
      const trimmedDescription = description.trim();
      const created = await createLesson(getAuthService().getClient(), tenantId, courseId, sectionId, {
        title: title.trim(),
        description: trimmedDescription ? trimmedDescription : undefined,
        type,
        ...(type === "VIDEO" ? { videoAssetId: selectedContentId as string } : {}),
        ...(type === "DOCUMENT" ? { documentAssetId: selectedContentId as string } : {}),
        ...(type === "QUIZ" ? { quizId: selectedContentId as string } : {}),
        ...(availableFrom ? { availableFrom: fromDateTimeLocalValue(availableFrom) as string } : {}),
        ...(availableUntil ? { availableUntil: fromDateTimeLocalValue(availableUntil) as string } : {}),
      });
      onCreated(created);
    } catch (error) {
      if (isNetworkError(error)) {
        setBackendError(t("shell.apiUnavailable"));
      } else {
        setBackendError(t(resolveErrorMessageKey(error, "lessons.createErrorGeneric")));
      }
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <Modal titleId="create-lesson-title" onClose={onClose}>
      <form className="auth-form" onSubmit={submit} noValidate>
        <h2 id="create-lesson-title">{t("lessons.createDialogTitle")}</h2>
        <p className="form-note">{t("lessons.createDialogCopy")}</p>

        <div className="field">
          <label htmlFor="lesson-title">{t("courses.titleLabel")}</label>
          <input
            id="lesson-title"
            name="title"
            type="text"
            maxLength={240}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            aria-invalid={errors.title ? "true" : "false"}
            aria-describedby={errors.title ? "lesson-title-error" : undefined}
          />
          {errors.title ? (
            <p className="field-error" id="lesson-title-error">
              {errors.title === "required" ? t("courses.titleRequired") : t("courses.titleTooLong")}
            </p>
          ) : null}
        </div>

        <div className="field">
          <label htmlFor="lesson-description">{t("courses.descriptionLabel")}</label>
          <textarea
            id="lesson-description"
            name="description"
            rows={3}
            maxLength={5000}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            aria-invalid={errors.description ? "true" : "false"}
            aria-describedby={errors.description ? "lesson-description-error" : undefined}
          />
          {errors.description ? (
            <p className="field-error" id="lesson-description-error">
              {t("courses.descriptionTooLong")}
            </p>
          ) : null}
        </div>

        <div className="field">
          <span id="lesson-type-label">{t("lessons.typeLabel")}</span>
          <div className="lesson-type-options" role="radiogroup" aria-labelledby="lesson-type-label">
            {(["VIDEO", "DOCUMENT", "QUIZ"] as const).map((kind) => (
              <label className="lesson-type-option" key={kind}>
                <input type="radio" name="lessonType" checked={type === kind} onChange={() => handleTypeChange(kind)} />
                <span>{t(LESSON_TYPE_KEY[kind])}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="field">
          <span id="content-selector-label">{t(CONTENT_PICKER_LABEL_KEY[type])}</span>

          {contentState.status === "loading" ? (
            <p className="overview-loading" role="status">
              {t("overview.loading")}
            </p>
          ) : contentState.status === "error" ? (
            <div className="overview-unavailable">
              {isNetworkError(contentState.error) ? t("shell.apiUnavailable") : t("lessons.contentLoadError")}{" "}
              <button className="ghost-button compact" type="button" onClick={retryContent}>
                {t("shell.retry")}
              </button>
            </div>
          ) : contentState.data.items.length === 0 ? (
            <div className="empty-state empty-state-compact">
              <span className="empty-state-icon" aria-hidden="true">
                <NavIcon section={CONTENT_PICKER_ICON_SECTION[type]} />
              </span>
              <p>{t(CONTENT_PICKER_EMPTY_KEY[type])}</p>
            </div>
          ) : (
            <>
              <ul className="course-selector-list" role="radiogroup" aria-labelledby="content-selector-label">
                {contentState.data.items.map((item) => (
                  <ContentOptionRow
                    key={contentOptionId(type, item)}
                    type={type}
                    item={item}
                    selected={selectedContentId === contentOptionId(type, item)}
                    onSelect={() => {
                      setSelectedContentId(contentOptionId(type, item));
                      setSelectError(false);
                    }}
                  />
                ))}
              </ul>
              <div className="course-selector-pagination">
                <span className="course-selector-page-label">
                  {t("lessons.contentPickerPageLabel").replace("{page}", String(contentOffset / CONTENT_PICKER_PAGE_SIZE + 1))}
                </span>
                <div className="pagination-controls" aria-label={t("pagination.pageLabel")}>
                  <button
                    className="secondary-button compact"
                    type="button"
                    onClick={() => setContentOffset((value) => previousOffset(value, CONTENT_PICKER_PAGE_SIZE))}
                    disabled={!canGoPrevious(contentOffset)}
                  >
                    {t("pagination.previous")}
                  </button>
                  <button
                    className="secondary-button compact"
                    type="button"
                    onClick={() => setContentOffset((value) => nextOffset(value, CONTENT_PICKER_PAGE_SIZE))}
                    disabled={!canGoNext(contentState.data.hasMore)}
                  >
                    {t("pagination.next")}
                  </button>
                </div>
              </div>
              {contentState.data.hasMore ? <p className="course-selector-more-note">{t("lessons.contentPickerMoreNote")}</p> : null}
            </>
          )}
          {selectError ? (
            <p className="field-error" role="alert">
              {t("lessons.selectContentRequired")}
            </p>
          ) : null}
        </div>

        <div className="field">
          <label htmlFor="lesson-available-from">{t("lessons.availableFromLabel")}</label>
          {/* step=60: minute precision, deliberately - see edit-lesson-dialog.tsx. */}
          <input
            id="lesson-available-from"
            type="datetime-local"
            step={60}
            value={availableFrom}
            onChange={(event) => setAvailableFrom(event.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="lesson-available-until">{t("lessons.availableUntilLabel")}</label>
          <input
            id="lesson-available-until"
            type="datetime-local"
            step={60}
            value={availableUntil}
            onChange={(event) => setAvailableUntil(event.target.value)}
          />
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
            {submitting ? t("lessons.createSubmitting") : t("lessons.createSubmit")}
          </button>
        </div>
      </form>
    </Modal>
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
