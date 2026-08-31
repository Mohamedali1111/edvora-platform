"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { Modal } from "@/features/instructor/students/dialog";
import { getAuthService } from "@/lib/api/session";
import type { QuizRevealAnswersPolicy } from "@/lib/api/types";
import { useI18n } from "@/lib/i18n/i18n";
import { createQuiz } from "./quizzes-service";
import { isNetworkError, resolveErrorMessageKey } from "./error-mapping";
import { buildQuizCreatePayload, type QuizFormErrors } from "./validation";

export function CreateQuizDialog({ tenantId, onClose }: { tenantId: string; onClose: () => void }) {
  const router = useRouter();
  const { t } = useI18n();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [passingScorePercent, setPassingScorePercent] = useState("");
  const [attemptLimit, setAttemptLimit] = useState("");
  const [revealAnswersPolicy, setRevealAnswersPolicy] = useState<QuizRevealAnswersPolicy>("AFTER_SUBMISSION");
  const [errors, setErrors] = useState<QuizFormErrors>({});
  const [backendError, setBackendError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (submittingRef.current) {
      return;
    }

    const result = buildQuizCreatePayload({ title, description, passingScorePercent, attemptLimit, revealAnswersPolicy });
    setErrors(result.errors);
    setBackendError(null);

    if (!result.payload) {
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);

    try {
      const created = await createQuiz(getAuthService().getClient(), tenantId, result.payload);
      router.push(`/instructor/quizzes/${created.quizId}`);
    } catch (error) {
      if (isNetworkError(error)) {
        setBackendError(t("shell.apiUnavailable"));
      } else {
        setBackendError(t(resolveErrorMessageKey(error, "quizzes.createErrorGeneric")));
      }
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <Modal titleId="create-quiz-title" onClose={onClose}>
      <form className="auth-form" onSubmit={submit} noValidate>
        <h2 id="create-quiz-title">{t("quizzes.createDialogTitle")}</h2>
        <p className="form-note">{t("quizzes.createDialogCopy")}</p>

        <QuizMetadataFields
          prefix="create"
          title={title}
          description={description}
          passingScorePercent={passingScorePercent}
          attemptLimit={attemptLimit}
          revealAnswersPolicy={revealAnswersPolicy}
          errors={errors}
          disabled={submitting}
          onTitleChange={setTitle}
          onDescriptionChange={setDescription}
          onPassingScorePercentChange={setPassingScorePercent}
          onAttemptLimitChange={setAttemptLimit}
          onRevealAnswersPolicyChange={setRevealAnswersPolicy}
        />

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
            {submitting ? t("quizzes.createSubmitting") : t("quizzes.createSubmit")}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function QuizMetadataFields({
  prefix,
  title,
  description,
  passingScorePercent,
  attemptLimit,
  revealAnswersPolicy,
  errors,
  disabled,
  onTitleChange,
  onDescriptionChange,
  onPassingScorePercentChange,
  onAttemptLimitChange,
  onRevealAnswersPolicyChange,
}: {
  prefix: string;
  title: string;
  description: string;
  passingScorePercent: string;
  attemptLimit: string;
  revealAnswersPolicy: QuizRevealAnswersPolicy;
  errors: QuizFormErrors;
  disabled?: boolean;
  onTitleChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onPassingScorePercentChange: (value: string) => void;
  onAttemptLimitChange: (value: string) => void;
  onRevealAnswersPolicyChange: (value: QuizRevealAnswersPolicy) => void;
}) {
  const { t } = useI18n();

  return (
    <>
      <div className="field">
        <label htmlFor={`${prefix}-quiz-title`}>{t("quizzes.titleLabel")}</label>
        <input
          id={`${prefix}-quiz-title`}
          type="text"
          maxLength={240}
          value={title}
          disabled={disabled}
          onChange={(event) => onTitleChange(event.target.value)}
          aria-invalid={errors.title ? "true" : "false"}
          aria-describedby={errors.title ? `${prefix}-quiz-title-error` : undefined}
        />
        {errors.title ? (
          <p className="field-error" id={`${prefix}-quiz-title-error`}>
            {errors.title === "required" ? t("quizzes.titleRequired") : t("quizzes.titleTooLong")}
          </p>
        ) : null}
      </div>

      <div className="field">
        <label htmlFor={`${prefix}-quiz-description`}>{t("quizzes.descriptionLabel")}</label>
        <textarea
          id={`${prefix}-quiz-description`}
          rows={4}
          maxLength={5000}
          value={description}
          disabled={disabled}
          onChange={(event) => onDescriptionChange(event.target.value)}
          aria-invalid={errors.description ? "true" : "false"}
          aria-describedby={errors.description ? `${prefix}-quiz-description-error` : undefined}
        />
        {errors.description ? (
          <p className="field-error" id={`${prefix}-quiz-description-error`}>
            {t("quizzes.descriptionTooLong")}
          </p>
        ) : null}
      </div>

      <div className="quiz-form-grid">
        <div className="field">
          <label htmlFor={`${prefix}-quiz-passing`}>{t("quizzes.passingScoreLabel")}</label>
          <input
            id={`${prefix}-quiz-passing`}
            type="text"
            inputMode="decimal"
            value={passingScorePercent}
            disabled={disabled}
            onChange={(event) => onPassingScorePercentChange(event.target.value)}
            aria-invalid={errors.passingScorePercent ? "true" : "false"}
            aria-describedby={errors.passingScorePercent ? `${prefix}-quiz-passing-error` : undefined}
          />
          {errors.passingScorePercent ? (
            <p className="field-error" id={`${prefix}-quiz-passing-error`}>
              {t("quizzes.passingScoreInvalid")}
            </p>
          ) : null}
        </div>

        <div className="field">
          <label htmlFor={`${prefix}-quiz-attempt-limit`}>{t("quizzes.attemptLimitLabel")}</label>
          <input
            id={`${prefix}-quiz-attempt-limit`}
            type="text"
            inputMode="numeric"
            value={attemptLimit}
            disabled={disabled}
            onChange={(event) => onAttemptLimitChange(event.target.value)}
            aria-invalid={errors.attemptLimit ? "true" : "false"}
            aria-describedby={errors.attemptLimit ? `${prefix}-quiz-attempt-limit-error` : undefined}
          />
          {errors.attemptLimit ? (
            <p className="field-error" id={`${prefix}-quiz-attempt-limit-error`}>
              {t("quizzes.attemptLimitInvalid")}
            </p>
          ) : null}
        </div>
      </div>

      <div className="field">
        <label htmlFor={`${prefix}-quiz-reveal-policy`}>{t("quizzes.revealPolicyLabel")}</label>
        <select
          id={`${prefix}-quiz-reveal-policy`}
          value={revealAnswersPolicy}
          disabled={disabled}
          onChange={(event) => onRevealAnswersPolicyChange(event.target.value as QuizRevealAnswersPolicy)}
        >
          <option value="NEVER">{t("quizzes.revealNever")}</option>
          <option value="AFTER_SUBMISSION">{t("quizzes.revealAfterSubmission")}</option>
          <option value="AFTER_PASSING">{t("quizzes.revealAfterPassing")}</option>
        </select>
      </div>
    </>
  );
}
