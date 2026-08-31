"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { getAuthService } from "@/lib/api/session";
import { useI18n } from "@/lib/i18n/i18n";
import type { CourseVisibility } from "@/lib/api/types";
import { Modal } from "@/features/instructor/students/dialog";
import { createCourse } from "./courses-service";
import { isNetworkError, resolveErrorMessageKey } from "./error-mapping";
import { validateCourseInput } from "./validation";

/**
 * Creates a DRAFT course (status is always server-derived - never sent) and
 * routes straight to its detail page on success, since that's the natural
 * next step for a brand-new course and a real courseId is now available.
 */
export function CreateCourseDialog({ tenantId, onClose }: { tenantId: string; onClose: () => void }) {
  const router = useRouter();
  const { t } = useI18n();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<CourseVisibility>("ENROLLED_ONLY");
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
      const created = await createCourse(getAuthService().getClient(), tenantId, {
        title: title.trim(),
        description: trimmedDescription ? trimmedDescription : undefined,
        visibility,
      });
      router.push(`/instructor/courses/${created.courseId}`);
    } catch (error) {
      if (isNetworkError(error)) {
        setBackendError(t("shell.apiUnavailable"));
      } else {
        setBackendError(t(resolveErrorMessageKey(error, "courses.createErrorGeneric")));
      }
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <Modal titleId="create-course-title" onClose={onClose}>
      <form className="auth-form" onSubmit={submit} noValidate>
        <h2 id="create-course-title">{t("courses.createDialogTitle")}</h2>
        <p className="form-note">{t("courses.createDialogCopy")}</p>

        <div className="field">
          <label htmlFor="course-title">{t("courses.titleLabel")}</label>
          <input
            id="course-title"
            name="title"
            type="text"
            maxLength={240}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            aria-invalid={errors.title ? "true" : "false"}
            aria-describedby={errors.title ? "course-title-error" : undefined}
          />
          {errors.title ? (
            <p className="field-error" id="course-title-error">
              {errors.title === "required" ? t("courses.titleRequired") : t("courses.titleTooLong")}
            </p>
          ) : null}
        </div>

        <div className="field">
          <label htmlFor="course-description">{t("courses.descriptionLabel")}</label>
          <textarea
            id="course-description"
            name="description"
            rows={4}
            maxLength={5000}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            aria-invalid={errors.description ? "true" : "false"}
            aria-describedby={errors.description ? "course-description-error" : undefined}
          />
          {errors.description ? (
            <p className="field-error" id="course-description-error">
              {t("courses.descriptionTooLong")}
            </p>
          ) : null}
        </div>

        <div className="field">
          <label htmlFor="course-visibility">{t("courses.visibilityLabel")}</label>
          <select id="course-visibility" value={visibility} onChange={(event) => setVisibility(event.target.value as CourseVisibility)}>
            <option value="ENROLLED_ONLY">{t("courses.visibilityEnrolledOnly")}</option>
            <option value="PRIVATE">{t("courses.visibilityPrivate")}</option>
          </select>
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
            {submitting ? t("courses.createSubmitting") : t("courses.createSubmit")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
