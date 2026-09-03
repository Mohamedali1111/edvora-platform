"use client";

import { useRef, useState } from "react";
import { getAuthService } from "@/lib/api/session";
import type { QuizSummary } from "@/lib/api/types";
import { useI18n } from "@/lib/i18n/i18n";
import type { TranslationKey } from "@/lib/i18n/translations";
import { LifecycleActionDialog, type LifecycleActionCopy } from "@/features/instructor/lifecycle-action-dialog";
import { archiveQuiz, publishQuiz, restoreQuiz, unpublishQuiz } from "./quizzes-service";
import { isNetworkError, isQuizLifecycleConflict, isQuizPublishabilityConflict, resolveErrorMessageKey } from "./error-mapping";

export type QuizLifecycleAction = "publish" | "takeOffline" | "archive" | "restore";

const COPY: Record<QuizLifecycleAction, LifecycleActionCopy> = {
  publish: {
    title: "quizzes.publishDialogTitle",
    body: "quizzes.publishDialogCopy",
    confirm: "quizzes.publishConfirm",
    pending: "quizzes.publishing",
  },
  takeOffline: {
    title: "quizzes.takeOfflineDialogTitle",
    body: "quizzes.takeOfflineDialogCopy",
    confirm: "quizzes.takeOfflineConfirm",
    pending: "quizzes.takingOffline",
  },
  archive: {
    title: "quizzes.archiveDialogTitle",
    body: "quizzes.archiveDialogCopy",
    confirm: "quizzes.archiveConfirm",
    pending: "quizzes.archiving",
  },
  restore: {
    title: "quizzes.restoreDialogTitle",
    body: "quizzes.restoreDialogCopy",
    confirm: "quizzes.restoreConfirm",
    pending: "quizzes.restoring",
  },
};

const ERROR_FALLBACK: Record<QuizLifecycleAction, TranslationKey> = {
  publish: "quizzes.publishErrorGeneric",
  takeOffline: "quizzes.takeOfflineErrorGeneric",
  archive: "quizzes.archiveErrorGeneric",
  restore: "quizzes.restoreErrorGeneric",
};

export function QuizLifecycleConfirmDialog({
  action,
  tenantId,
  quiz,
  onClose,
  onDone,
  onConflict,
}: {
  action: QuizLifecycleAction;
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
      const result =
        action === "publish"
          ? await publishQuiz(client, tenantId, quiz.quizId)
          : action === "takeOffline"
            ? await unpublishQuiz(client, tenantId, quiz.quizId)
            : action === "archive"
              ? await archiveQuiz(client, tenantId, quiz.quizId)
              : await restoreQuiz(client, tenantId, quiz.quizId);
      onDone(result);
    } catch (error) {
      if (isNetworkError(error)) {
        setBackendError(t("shell.apiUnavailable"));
      } else {
        setBackendError(t(resolveErrorMessageKey(error, ERROR_FALLBACK[action])));

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
    <LifecycleActionDialog
      titleId="quiz-lifecycle-title"
      entityTitle={quiz.title}
      copy={copy}
      danger={action === "archive"}
      backendError={backendError}
      submitting={submitting}
      onConfirm={confirm}
      onClose={onClose}
    />
  );
}
