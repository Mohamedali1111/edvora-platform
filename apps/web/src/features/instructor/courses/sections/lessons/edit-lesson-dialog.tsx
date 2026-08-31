"use client";

import { useRef, useState, type FormEvent } from "react";
import { Modal } from "@/features/instructor/students/dialog";
import { validateCourseInput } from "@/features/instructor/courses/validation";
import { getAuthService } from "@/lib/api/session";
import { useI18n } from "@/lib/i18n/i18n";
import type { LessonSummary } from "@/lib/api/types";
import { updateLesson } from "./lessons-service";
import { toDateTimeLocalValue } from "./format";
import { buildLessonUpdatePayload, type LessonAvailabilitySnapshot } from "./update-payload";
import { isLessonLifecycleConflict, isNetworkError, resolveErrorMessageKey } from "./error-mapping";

/**
 * Only ever opened for a lesson that was editable (DRAFT/PUBLISHED) when the
 * Edit action was clicked - ARCHIVED lessons don't render that action at all
 * (see lifecycle.ts / lessons-panel.tsx). `type` and the content reference
 * are never shown here - the frozen backend has no endpoint to change them
 * after creation. A conflict here means the lesson was archived from under
 * the page between then and submit; the underlying list is refetched in the
 * background (via onConflict) so the row reflects the real, current state
 * once this dialog is dismissed.
 */
export function EditLessonDialog({
  tenantId,
  courseId,
  sectionId,
  lesson,
  onClose,
  onSaved,
  onConflict,
}: {
  tenantId: string;
  courseId: string;
  sectionId: string;
  lesson: LessonSummary;
  onClose: () => void;
  onSaved: (result: LessonSummary) => void;
  onConflict: () => void;
}) {
  const { t } = useI18n();
  const [title, setTitle] = useState(lesson.title);
  const [description, setDescription] = useState(lesson.description ?? "");
  // Captured once, on mount - the seeded snapshot the current availability
  // inputs are compared against to decide whether they're actually dirty.
  // See update-payload.ts for why equality-against-the-seed (rather than a
  // separate touched flag) is what protects the server's full-precision
  // timestamp from being silently truncated by an unrelated field edit.
  const [availabilitySnapshot] = useState<LessonAvailabilitySnapshot>(() => ({
    availableFromInput: toDateTimeLocalValue(lesson.availableFrom),
    availableUntilInput: toDateTimeLocalValue(lesson.availableUntil),
  }));
  const [availableFrom, setAvailableFrom] = useState(availabilitySnapshot.availableFromInput);
  const [availableUntil, setAvailableUntil] = useState(availabilitySnapshot.availableUntilInput);
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
      const payload = buildLessonUpdatePayload(availabilitySnapshot, {
        title,
        description,
        availableFromInput: availableFrom,
        availableUntilInput: availableUntil,
      });
      const saved = await updateLesson(getAuthService().getClient(), tenantId, courseId, sectionId, lesson.lessonId, payload);
      onSaved(saved);
    } catch (error) {
      if (isNetworkError(error)) {
        setBackendError(t("shell.apiUnavailable"));
      } else {
        setBackendError(t(resolveErrorMessageKey(error, "lessons.editErrorGeneric")));

        if (isLessonLifecycleConflict(error)) {
          onConflict();
        }
      }
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <Modal titleId="edit-lesson-title" onClose={onClose}>
      <form className="auth-form" onSubmit={submit} noValidate>
        <h2 id="edit-lesson-title">{t("lessons.editDialogTitle")}</h2>

        <div className="field">
          <label htmlFor="lesson-edit-title">{t("courses.titleLabel")}</label>
          <input
            id="lesson-edit-title"
            name="title"
            type="text"
            maxLength={240}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            aria-invalid={errors.title ? "true" : "false"}
            aria-describedby={errors.title ? "lesson-edit-title-error" : undefined}
          />
          {errors.title ? (
            <p className="field-error" id="lesson-edit-title-error">
              {errors.title === "required" ? t("courses.titleRequired") : t("courses.titleTooLong")}
            </p>
          ) : null}
        </div>

        <div className="field">
          <label htmlFor="lesson-edit-description">{t("courses.descriptionLabel")}</label>
          <textarea
            id="lesson-edit-description"
            name="description"
            rows={3}
            maxLength={5000}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            aria-invalid={errors.description ? "true" : "false"}
            aria-describedby={errors.description ? "lesson-edit-description-error" : undefined}
          />
          {errors.description ? (
            <p className="field-error" id="lesson-edit-description-error">
              {t("courses.descriptionTooLong")}
            </p>
          ) : null}
        </div>

        <div className="field">
          <label htmlFor="lesson-edit-available-from">{t("lessons.availableFromLabel")}</label>
          {/* step=60: minute precision is the deliberate, explicit precision a
              newly-entered value supports here - the backend's timestamptz(6)
              seconds/milliseconds are never exposed or claimed to round-trip
              for a value the instructor actually edits. An untouched value is
              never resent through this input at all (see update-payload.ts),
              so this cap never affects the server's existing precision. */}
          <input
            id="lesson-edit-available-from"
            type="datetime-local"
            step={60}
            value={availableFrom}
            onChange={(event) => setAvailableFrom(event.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="lesson-edit-available-until">{t("lessons.availableUntilLabel")}</label>
          <input
            id="lesson-edit-available-until"
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
            {submitting ? t("courses.saving") : t("courses.saveAction")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
