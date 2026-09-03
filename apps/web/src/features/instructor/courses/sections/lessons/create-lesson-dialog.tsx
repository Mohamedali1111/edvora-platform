"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent, type RefObject } from "react";
import { Modal } from "@/features/instructor/students/dialog";
// Lesson title/description constraints are identical to Course/Section's (1-240 char
// title, <=5000 char description) - reusing the existing validator rather than
// duplicating an identical rule set for a third resource.
import { validateCourseInput } from "@/features/instructor/courses/validation";
import { getAuthService } from "@/lib/api/session";
import { useI18n } from "@/lib/i18n/i18n";
import type { TranslationKey } from "@/lib/i18n/translations";
import type { LessonSummary, LessonType } from "@/lib/api/types";
import { createLesson } from "./lessons-service";
import { fromDateTimeLocalValue } from "./format";
import { isNetworkError, resolveErrorMessageKey } from "./error-mapping";
import { LessonTypeIcon } from "./add-lesson/lesson-type-icons";
import { ContentPicker } from "./add-lesson/content-picker";
import { VideoContentStep } from "./add-lesson/video-content-step";
import { DocumentContentStep } from "./add-lesson/document-content-step";
import { QuizContentStep } from "./add-lesson/quiz-content-step";

const LESSON_TYPE_KEY: Record<LessonType, TranslationKey> = {
  VIDEO: "lessons.typeVideo",
  DOCUMENT: "lessons.typeDocument",
  QUIZ: "lessons.typeQuiz",
};

const LESSON_TYPE_DESCRIPTION_KEY: Record<LessonType, TranslationKey> = {
  VIDEO: "lessons.typeVideoDescription",
  DOCUMENT: "lessons.typeDocumentDescription",
  QUIZ: "lessons.typeQuizDescription",
};

const SOURCE_CREATE_LABEL_KEY: Record<LessonType, TranslationKey> = {
  VIDEO: "lessons.uploadNewVideoAction",
  DOCUMENT: "lessons.uploadNewDocumentAction",
  QUIZ: "lessons.createNewQuizAction",
};

const SOURCE_EXISTING_LABEL_KEY: Record<LessonType, TranslationKey> = {
  VIDEO: "lessons.chooseExistingVideoAction",
  DOCUMENT: "lessons.chooseExistingDocumentAction",
  QUIZ: "lessons.chooseExistingQuizAction",
};

type SourceMode = "create" | "existing";

/**
 * The redesigned Add Lesson experience (Part 3 of the authoring redesign):
 * type -> upload/create new OR choose existing -> lesson details, all
 * in-context and inside this one modal. The instructor is never sent to
 * Media or Quizzes as a required step. Every "create new" path reuses the
 * exact real upload/creation implementation Media/Quizzes already use (see
 * the `add-lesson/*-content-step.tsx` components) - this file only
 * orchestrates which step is showing and, at the end, calls the same
 * frozen `createLesson` contract the previous, existing-content-only
 * version of this dialog already used (exactly one already-existing
 * videoAssetId/documentAssetId/quizId is still required by the backend at
 * creation time; this flow just makes getting one effortless).
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
  const [type, setType] = useState<LessonType | null>(null);
  const [sourceMode, setSourceMode] = useState<SourceMode>("create");
  const [contentId, setContentId] = useState<string | null>(null);
  // Tracks a Quiz created *by this flow* (not selected from the library) so
  // the post-creation screen can offer "Edit questions" - a brand-new Quiz
  // always has zero questions and can't be published until it has some.
  const [createdQuizId, setCreatedQuizId] = useState<string | null>(null);
  const [createdLesson, setCreatedLesson] = useState<LessonSummary | null>(null);
  // True only while a Video/Document upload embedded in the current Content
  // step is actively transferring/finalizing - reported up by
  // `VideoContentStep`/`DocumentContentStep` via `onBusyChange`. Blocks
  // accidental Escape/scrim dismissal (below) and the Content step's own
  // Back button, so an in-flight upload's progress is never silently
  // abandoned by a stray keypress or backdrop click - see those
  // components' docstrings for exactly which upload states this covers and
  // why. The instructor's own deliberate "Continue with this video"/
  // completed-document-advance actions are never gated by this - only
  // accidental dismissal is.
  const [uploadBusy, setUploadBusy] = useState(false);

  const screen = type === null ? "type" : contentId === null ? "content" : createdLesson ? "created" : "details";
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, [screen]);

  function selectType(nextType: LessonType) {
    setType(nextType);
    setSourceMode("create");
    setContentId(null);
    setCreatedQuizId(null);
  }

  function backToType() {
    setType(null);
    setContentId(null);
    setCreatedQuizId(null);
  }

  function backToContent() {
    setContentId(null);
  }

  return (
    <Modal titleId="add-lesson-title" onClose={uploadBusy ? () => undefined : onClose}>
      {screen === "type" ? (
        <TypeStep headingRef={headingRef} onSelect={selectType} onClose={onClose} />
      ) : screen === "content" ? (
        <ContentStep
          headingRef={headingRef}
          type={type as LessonType}
          tenantId={tenantId}
          sourceMode={sourceMode}
          contentId={contentId}
          uploadBusy={uploadBusy}
          onBusyChange={setUploadBusy}
          onSourceModeChange={setSourceMode}
          onContentSelected={(id, wasCreatedQuiz) => {
            setContentId(id);
            if (wasCreatedQuiz) {
              setCreatedQuizId(id);
            }
          }}
          onBack={backToType}
        />
      ) : screen === "details" ? (
        <DetailsStep
          headingRef={headingRef}
          tenantId={tenantId}
          courseId={courseId}
          sectionId={sectionId}
          type={type as LessonType}
          contentId={contentId as string}
          onBack={backToContent}
          onClose={onClose}
          onCreated={(lesson) => {
            if (createdQuizId && createdQuizId === contentId) {
              setCreatedLesson(lesson);
            } else {
              onCreated(lesson);
            }
          }}
        />
      ) : (
        <CreatedStep headingRef={headingRef} lesson={createdLesson as LessonSummary} quizId={createdQuizId as string} onDone={() => onCreated(createdLesson as LessonSummary)} />
      )}
    </Modal>
  );
}

function TypeStep({
  headingRef,
  onSelect,
  onClose,
}: {
  headingRef: RefObject<HTMLHeadingElement | null>;
  onSelect: (type: LessonType) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();

  return (
    <div className="auth-form">
      <h2 id="add-lesson-title" ref={headingRef} tabIndex={-1}>
        {t("lessons.createDialogTitle")}
      </h2>
      <p className="form-note">{t("lessons.addLessonTypeStepCopy")}</p>

      <div className="lesson-type-cards" role="group" aria-labelledby="add-lesson-title">
        {(["VIDEO", "DOCUMENT", "QUIZ"] as const).map((kind) => (
          <button key={kind} type="button" className="lesson-type-card" onClick={() => onSelect(kind)}>
            <span className="lesson-type-card-icon" aria-hidden="true">
              <LessonTypeIcon type={kind} />
            </span>
            <span className="lesson-type-card-title">{t(LESSON_TYPE_KEY[kind])}</span>
            <span className="lesson-type-card-description">{t(LESSON_TYPE_DESCRIPTION_KEY[kind])}</span>
          </button>
        ))}
      </div>

      <div className="modal-actions">
        <button className="secondary-button" type="button" onClick={onClose}>
          {t("common.cancel")}
        </button>
      </div>
    </div>
  );
}

function ContentStep({
  headingRef,
  type,
  tenantId,
  sourceMode,
  contentId,
  uploadBusy,
  onBusyChange,
  onSourceModeChange,
  onContentSelected,
  onBack,
}: {
  headingRef: RefObject<HTMLHeadingElement | null>;
  type: LessonType;
  tenantId: string;
  sourceMode: SourceMode;
  contentId: string | null;
  uploadBusy: boolean;
  onBusyChange: (busy: boolean) => void;
  onSourceModeChange: (mode: SourceMode) => void;
  onContentSelected: (id: string, wasCreatedQuiz: boolean) => void;
  onBack: () => void;
}) {
  const { t } = useI18n();

  return (
    <div className="auth-form">
      <button
        className="ghost-button compact add-lesson-back"
        type="button"
        onClick={onBack}
        disabled={uploadBusy}
        aria-disabled={uploadBusy}
      >
        {t("lessons.backAction")}
      </button>
      <h2 id="add-lesson-title" ref={headingRef} tabIndex={-1}>
        {t(LESSON_TYPE_KEY[type])}
      </h2>

      {/* A plain two-button toggle, not `role="tablist"`: there is no
          associated `tabpanel`/roving-tabindex keyboard behavior implemented
          here, and an incomplete tabs pattern is worse for assistive tech
          than a correctly-labeled toggle-button group. `aria-pressed`
          communicates the current mode without implying capabilities this
          control doesn't have. Disabled while `uploadBusy` for the same
          reason Back is - switching tabs would unmount the actively
          uploading step exactly like Back/Escape/scrim would. */}
      <div className="add-lesson-source-toggle" role="group" aria-label={t(LESSON_TYPE_KEY[type])}>
        <button
          type="button"
          aria-pressed={sourceMode === "create"}
          className={sourceMode === "create" ? "add-lesson-source-tab active" : "add-lesson-source-tab"}
          onClick={() => onSourceModeChange("create")}
          disabled={uploadBusy}
        >
          {t(SOURCE_CREATE_LABEL_KEY[type])}
        </button>
        <button
          type="button"
          aria-pressed={sourceMode === "existing"}
          className={sourceMode === "existing" ? "add-lesson-source-tab active" : "add-lesson-source-tab"}
          onClick={() => onSourceModeChange("existing")}
          disabled={uploadBusy}
        >
          {t(SOURCE_EXISTING_LABEL_KEY[type])}
        </button>
      </div>

      {uploadBusy ? (
        <p className="form-note" role="status">
          {t("lessons.uploadBlocksNavigationNote")}
        </p>
      ) : null}

      {sourceMode === "existing" ? (
        <ContentPicker
          type={type}
          tenantId={tenantId}
          selectedId={contentId}
          onSelect={(id) => onContentSelected(id, false)}
          onSwitchToCreate={() => onSourceModeChange("create")}
        />
      ) : type === "VIDEO" ? (
        <VideoContentStep tenantId={tenantId} onSelected={(id) => onContentSelected(id, false)} onBusyChange={onBusyChange} />
      ) : type === "DOCUMENT" ? (
        <DocumentContentStep tenantId={tenantId} onSelected={(id) => onContentSelected(id, false)} onBusyChange={onBusyChange} />
      ) : (
        <QuizContentStep tenantId={tenantId} onSelected={(id) => onContentSelected(id, true)} />
      )}
    </div>
  );
}

function DetailsStep({
  headingRef,
  tenantId,
  courseId,
  sectionId,
  type,
  contentId,
  onBack,
  onClose,
  onCreated,
}: {
  headingRef: RefObject<HTMLHeadingElement | null>;
  tenantId: string;
  courseId: string;
  sectionId: string;
  type: LessonType;
  contentId: string;
  onBack: () => void;
  onClose: () => void;
  onCreated: (result: LessonSummary) => void;
}) {
  const { t } = useI18n();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [availableFrom, setAvailableFrom] = useState("");
  const [availableUntil, setAvailableUntil] = useState("");
  const [errors, setErrors] = useState<{ title?: "required" | "tooLong"; description?: "tooLong" }>({});
  const [backendError, setBackendError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (submittingRef.current) {
      return;
    }

    const nextErrors = validateCourseInput(title, description);
    setErrors(nextErrors);
    setBackendError(null);

    if (nextErrors.title || nextErrors.description) {
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
        ...(type === "VIDEO" ? { videoAssetId: contentId } : {}),
        ...(type === "DOCUMENT" ? { documentAssetId: contentId } : {}),
        ...(type === "QUIZ" ? { quizId: contentId } : {}),
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
    <form className="auth-form" onSubmit={submit} noValidate>
      <button className="ghost-button compact add-lesson-back" type="button" onClick={onBack} disabled={submitting}>
        {t("lessons.backAction")}
      </button>
      <h2 id="add-lesson-title" ref={headingRef} tabIndex={-1}>
        {t("lessons.detailsStepTitle")}
      </h2>

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
  );
}

function CreatedStep({
  headingRef,
  lesson,
  quizId,
  onDone,
}: {
  headingRef: RefObject<HTMLHeadingElement | null>;
  lesson: LessonSummary;
  quizId: string;
  onDone: () => void;
}) {
  const { t } = useI18n();

  return (
    <div className="auth-form">
      <h2 id="add-lesson-title" ref={headingRef} tabIndex={-1}>
        {t("lessons.lessonAddedTitle")}
      </h2>
      <p className="form-note">
        <strong>{lesson.title}</strong>
      </p>
      <p className="form-note">{t("lessons.quizCreatedEditQuestionsHint")}</p>

      <div className="modal-actions">
        <button className="secondary-button" type="button" onClick={onDone}>
          {t("common.done")}
        </button>
        <Link className="primary-button" href={`/instructor/quizzes/${quizId}`} onClick={onDone}>
          {t("lessons.editQuestionsAction")}
        </Link>
      </div>
    </div>
  );
}
