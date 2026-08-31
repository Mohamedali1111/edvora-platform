"use client";

import { useRef, useState, type FormEvent } from "react";
import { Modal } from "@/features/instructor/students/dialog";
import { validateCourseInput } from "@/features/instructor/courses/validation";
import { getAuthService } from "@/lib/api/session";
import { useI18n } from "@/lib/i18n/i18n";
import type { CourseSectionSummary } from "@/lib/api/types";
import { updateSection } from "./sections-service";
import { isNetworkError, isSectionLifecycleConflict, resolveErrorMessageKey } from "./error-mapping";

/**
 * Only ever opened for a section that was editable (DRAFT/PUBLISHED) when the
 * Edit action was clicked - the caller doesn't render that action at all for
 * an ARCHIVED section (see sections-panel.tsx / lifecycle.ts). A conflict
 * here means the section was archived from under the page between then and
 * submit; on that specific error this refetches the list in the background
 * (via onConflict) so the row reflects the real, current state once this
 * dialog is dismissed, rather than leaving a save button that would only
 * fail the same way again.
 */
export function EditSectionDialog({
  tenantId,
  courseId,
  section,
  onClose,
  onSaved,
  onConflict,
}: {
  tenantId: string;
  courseId: string;
  section: CourseSectionSummary;
  onClose: () => void;
  onSaved: (result: CourseSectionSummary) => void;
  onConflict: () => void;
}) {
  const { t } = useI18n();
  const [title, setTitle] = useState(section.title);
  const [description, setDescription] = useState(section.description ?? "");
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
      const saved = await updateSection(getAuthService().getClient(), tenantId, courseId, section.sectionId, {
        title: title.trim(),
        description: trimmedDescription ? trimmedDescription : null,
      });
      onSaved(saved);
    } catch (error) {
      if (isNetworkError(error)) {
        setBackendError(t("shell.apiUnavailable"));
      } else {
        setBackendError(t(resolveErrorMessageKey(error, "sections.editErrorGeneric")));

        if (isSectionLifecycleConflict(error)) {
          onConflict();
        }
      }
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <Modal titleId="edit-section-title" onClose={onClose}>
      <form className="auth-form" onSubmit={submit} noValidate>
        <h2 id="edit-section-title">{t("sections.editDialogTitle")}</h2>

        <div className="field">
          <label htmlFor="section-edit-title">{t("courses.titleLabel")}</label>
          <input
            id="section-edit-title"
            name="title"
            type="text"
            maxLength={240}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            aria-invalid={errors.title ? "true" : "false"}
            aria-describedby={errors.title ? "section-edit-title-error" : undefined}
          />
          {errors.title ? (
            <p className="field-error" id="section-edit-title-error">
              {errors.title === "required" ? t("courses.titleRequired") : t("courses.titleTooLong")}
            </p>
          ) : null}
        </div>

        <div className="field">
          <label htmlFor="section-edit-description">{t("courses.descriptionLabel")}</label>
          <textarea
            id="section-edit-description"
            name="description"
            rows={4}
            maxLength={5000}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            aria-invalid={errors.description ? "true" : "false"}
            aria-describedby={errors.description ? "section-edit-description-error" : undefined}
          />
          {errors.description ? (
            <p className="field-error" id="section-edit-description-error">
              {t("courses.descriptionTooLong")}
            </p>
          ) : null}
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
