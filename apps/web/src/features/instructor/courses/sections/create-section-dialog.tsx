"use client";

import { useRef, useState, type FormEvent } from "react";
import { Modal } from "@/features/instructor/students/dialog";
// Section title/description constraints are identical to Course's (1-240 char
// title, <=5000 char description) - reusing the existing validator rather than
// duplicating an identical rule set for a second resource.
import { validateCourseInput } from "@/features/instructor/courses/validation";
import { getAuthService } from "@/lib/api/session";
import { useI18n } from "@/lib/i18n/i18n";
import type { CourseSectionSummary } from "@/lib/api/types";
import { createSection } from "./sections-service";
import { isNetworkError, resolveErrorMessageKey } from "./error-mapping";

export function CreateSectionDialog({
  tenantId,
  courseId,
  onClose,
  onCreated,
}: {
  tenantId: string;
  courseId: string;
  onClose: () => void;
  onCreated: (result: CourseSectionSummary) => void;
}) {
  const { t } = useI18n();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
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
      const created = await createSection(getAuthService().getClient(), tenantId, courseId, {
        title: title.trim(),
        description: trimmedDescription ? trimmedDescription : undefined,
      });
      onCreated(created);
    } catch (error) {
      if (isNetworkError(error)) {
        setBackendError(t("shell.apiUnavailable"));
      } else {
        setBackendError(t(resolveErrorMessageKey(error, "sections.createErrorGeneric")));
      }
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <Modal titleId="create-section-title" onClose={onClose}>
      <form className="auth-form" onSubmit={submit} noValidate>
        <h2 id="create-section-title">{t("sections.createDialogTitle")}</h2>
        <p className="form-note">{t("sections.createDialogCopy")}</p>

        <div className="field">
          <label htmlFor="section-title">{t("courses.titleLabel")}</label>
          <input
            id="section-title"
            name="title"
            type="text"
            maxLength={240}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            aria-invalid={errors.title ? "true" : "false"}
            aria-describedby={errors.title ? "section-title-error" : undefined}
          />
          {errors.title ? (
            <p className="field-error" id="section-title-error">
              {errors.title === "required" ? t("courses.titleRequired") : t("courses.titleTooLong")}
            </p>
          ) : null}
        </div>

        <div className="field">
          <label htmlFor="section-description">{t("courses.descriptionLabel")}</label>
          <textarea
            id="section-description"
            name="description"
            rows={4}
            maxLength={5000}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            aria-invalid={errors.description ? "true" : "false"}
            aria-describedby={errors.description ? "section-description-error" : undefined}
          />
          {errors.description ? (
            <p className="field-error" id="section-description-error">
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
            {submitting ? t("sections.createSubmitting") : t("sections.createSubmit")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
