"use client";

import { useRef, useState, type FormEvent } from "react";
import { QuizMetadataFields } from "@/features/instructor/quizzes/create-quiz-dialog";
import { isNetworkError, resolveErrorMessageKey } from "@/features/instructor/quizzes/error-mapping";
import { createQuiz } from "@/features/instructor/quizzes/quizzes-service";
import { buildQuizCreatePayload, type QuizFormErrors } from "@/features/instructor/quizzes/validation";
import { getAuthService } from "@/lib/api/session";
import { useI18n } from "@/lib/i18n/i18n";
import type { QuizRevealAnswersPolicy } from "@/lib/api/types";

/**
 * "Create new quiz" side of the Add Lesson quiz content step. Reuses the
 * exact same `QuizMetadataFields`/`createQuiz` the standalone Quiz Library
 * ("Create Quiz") flow uses - a minimal setup form only (title/description/
 * passing score/attempt limit/reveal policy), never a full question editor
 * crammed into this step. Once the Quiz is created, the Lesson can be
 * created and attached to it immediately; question authoring continues
 * afterward via the "Edit questions" link the Add Lesson flow offers next
 * (see create-lesson-dialog.tsx), matching Part 3's suggested flow exactly.
 */
export function QuizContentStep({ tenantId, onSelected }: { tenantId: string; onSelected: (quizId: string) => void }) {
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
      onSelected(created.quizId);
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
    <form className="auth-form" onSubmit={submit} noValidate>
      <QuizMetadataFields
        prefix="add-lesson-quiz"
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
        <button className="primary-button" type="submit" disabled={submitting}>
          {submitting ? t("quizzes.createSubmitting") : t("lessons.createQuizContinueAction")}
        </button>
      </div>
    </form>
  );
}
