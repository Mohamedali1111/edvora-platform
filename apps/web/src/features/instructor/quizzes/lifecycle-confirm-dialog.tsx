"use client";

import { useRef, useState } from "react";
import { Modal } from "@/features/instructor/students/dialog";
import { getAuthService } from "@/lib/api/session";
import type { QuizSummary } from "@/lib/api/types";
import { useI18n } from "@/lib/i18n/i18n";
import type { TranslationKey } from "@/lib/i18n/translations";
import { archiveQuiz, publishQuiz } from "./quizzes-service";
import { isNetworkError, isQuizLifecycleConflict, isQuizPublishabilityConflict, resolveErrorMessageKey } from "./error-mapping";

type LifecycleAction = "publish" | "archive";

const COPY: Record<LifecycleAction, { title: TranslationKey; body: TranslationKey; confirm: TranslationKey; pending: TranslationKey; errorFallback: TranslationKey }> = {
  publish: {
    title: "quizzes.publishDialogTitle",
    body: "quizzes.publishDialogCopy",
    confirm: "quizzes.publishConfirm",
    pending: "quizzes.publishing",
    errorFallback: "quizzes.publishErrorGeneric",
  },
  archive: {
    title: "quizzes.archiveDialogTitle",
    body: "quizzes.archiveDialogCopy",
    confirm: "quizzes.archiveConfirm",
    pending: "quizzes.archiving",
    errorFallback: "quizzes.archiveErrorGeneric",
  },
};

export function QuizLifecycleConfirmDialog({
  action,
  tenantId,
  quiz,
  onClose,
  onDone,
  onConflict,
}: {
  action: LifecycleAction;
  tenantId: string;
  quiz: QuizSummary;
  onClose: () => void;
  onDone: (result: QuizSummary) => void;
  onConflict: () => void;
}) {
  const { t } = useI18n();
  const [backendError, setBackendError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const copy = COPY[action];

  async function confirm() {
    if (submittingRef.current) {
      return;
    }

    setBackendError(null);
    submittingRef.current = true;
    setSubmitting(true);

    try {
      const client = getAuthService().getClient();
      const result = action === "publish" ? await publishQuiz(client, tenantId, quiz.quizId) : await archiveQuiz(client, tenantId, quiz.quizId);
      onDone(result);
    } catch (error) {
      if (isNetworkError(error)) {
        setBackendError(t("shell.apiUnavailable"));
      } else {
        setBackendError(t(resolveErrorMessageKey(error, copy.errorFallback)));

        if (isQuizLifecycleConflict(error) || isQuizPublishabilityConflict(error)) {
          onConflict();
        }
      }
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <Modal titleId="quiz-lifecycle-title" onClose={onClose}>
      <div className="auth-form">
        <h2 id="quiz-lifecycle-title">{t(copy.title)}</h2>
        <p className="form-note">
          {t(copy.body)} <strong>{quiz.title}</strong>
        </p>

        {backendError ? (
          <div className="form-error" role="alert">
            {backendError}
          </div>
        ) : null}

        <div className="modal-actions">
          <button className="secondary-button" type="button" onClick={onClose} disabled={submitting} autoFocus>
            {t("common.cancel")}
          </button>
          <button
            className={action === "archive" ? "primary-button danger-button" : "primary-button"}
            type="button"
            onClick={confirm}
            disabled={submitting}
          >
            {submitting ? t(copy.pending) : t(copy.confirm)}
          </button>
        </div>
      </div>
    </Modal>
  );
}
