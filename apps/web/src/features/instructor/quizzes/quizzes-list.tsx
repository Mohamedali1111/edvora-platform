"use client";

import Link from "next/link";
import { useState } from "react";
import { useAuthenticatedInstructorSession } from "@/features/instructor/session-context";
import { ActionMenu, type ActionMenuItem } from "@/features/instructor/action-menu";
import { formatDate } from "@/features/instructor/students/format";
import { canGoNext, canGoPrevious, nextOffset, previousOffset } from "@/features/instructor/students/pagination";
import type { QuizRevealAnswersPolicy, QuizStatus, QuizSummary } from "@/lib/api/types";
import { useI18n } from "@/lib/i18n/i18n";
import type { TranslationKey } from "@/lib/i18n/translations";
import { CreateQuizDialog } from "./create-quiz-dialog";
import { isNetworkError } from "./error-mapping";
import { canArchiveQuiz, canPublishQuiz, canRestoreQuiz, canTakeQuizOffline } from "./lifecycle";
import { QuizLifecycleConfirmDialog, type QuizLifecycleAction } from "./lifecycle-confirm-dialog";
import { QUIZZES_PAGE_SIZE, useQuizzesList } from "./quizzes-service";

const QUIZ_STATUS_KEY: Record<QuizStatus, TranslationKey> = {
  DRAFT: "status.quizDraft",
  PUBLISHED: "status.quizPublished",
  ARCHIVED: "status.quizArchived",
};

const REVEAL_POLICY_KEY: Record<QuizRevealAnswersPolicy, TranslationKey> = {
  NEVER: "quizzes.revealNever",
  AFTER_SUBMISSION: "quizzes.revealAfterSubmission",
  AFTER_PASSING: "quizzes.revealAfterPassing",
};

type LifecycleTarget = { action: QuizLifecycleAction; quiz: QuizSummary };

export function QuizzesList() {
  const { tenant } = useAuthenticatedInstructorSession();
  const { t } = useI18n();
  const [offset, setOffset] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [lifecycleTarget, setLifecycleTarget] = useState<LifecycleTarget | null>(null);
  const { state, retry } = useQuizzesList(tenant.tenantId, offset);

  function quizActions(quiz: QuizSummary): ActionMenuItem[] {
    const items: ActionMenuItem[] = [];

    if (canPublishQuiz(quiz.status)) {
      items.push({ key: "publish", label: t("quizzes.publishAction"), onSelect: () => setLifecycleTarget({ action: "publish", quiz }) });
    }

    if (canTakeQuizOffline(quiz.status)) {
      items.push({
        key: "takeOffline",
        label: t("quizzes.takeOfflineAction"),
        onSelect: () => setLifecycleTarget({ action: "takeOffline", quiz }),
      });
    }

    if (canArchiveQuiz(quiz.status)) {
      items.push({
        key: "archive",
        label: t("quizzes.archiveAction"),
        danger: true,
        onSelect: () => setLifecycleTarget({ action: "archive", quiz }),
      });
    }

    if (canRestoreQuiz(quiz.status)) {
      items.push({ key: "restore", label: t("quizzes.restoreAction"), onSelect: () => setLifecycleTarget({ action: "restore", quiz }) });
    }

    return items;
  }

  return (
    <div className="quizzes-page">
      <div className="page-header">
        <div>
          <h2>{t("nav.quizzes")}</h2>
          <p className="page-subtitle">{t("quizzes.subtitle")}</p>
        </div>
        <button className="primary-button" type="button" onClick={() => setCreateOpen(true)}>
          {t("quizzes.createAction")}
        </button>
      </div>

      {state.status === "loading" ? (
        <p className="overview-loading" role="status">
          {t("overview.loading")}
        </p>
      ) : state.status === "error" ? (
        <div className="overview-error" role="alert">
          <p>{isNetworkError(state.error) ? t("shell.apiUnavailable") : t("quizzes.errorLoad")}</p>
          <button className="secondary-button compact-action" type="button" onClick={retry}>
            {t("shell.retry")}
          </button>
        </div>
      ) : state.data.items.length === 0 ? (
        <p className="overview-empty">{t("quizzes.empty")}</p>
      ) : (
        <>
          <div className="table-scroll">
            <table className="data-table">
              <caption className="sr-only">{t("nav.quizzes")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("quizzes.columnTitle")}</th>
                  <th scope="col">{t("quizzes.columnStatus")}</th>
                  <th scope="col" className="table-col-secondary">
                    {t("quizzes.columnPassing")}
                  </th>
                  <th scope="col" className="table-col-secondary">
                    {t("quizzes.columnAttempts")}
                  </th>
                  <th scope="col" className="table-col-secondary">
                    {t("quizzes.columnReveal")}
                  </th>
                  <th scope="col" className="table-col-secondary">
                    {t("quizzes.columnUpdated")}
                  </th>
                  <th scope="col">
                    <span className="sr-only">{t("quizzes.columnActions")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {state.data.items.map((quiz) => (
                  <tr key={quiz.quizId}>
                    <td>
                      <strong>{quiz.title}</strong>
                    </td>
                    <td>
                      <span className={`status-badge status-badge-${quiz.status.toLowerCase()}`}>{t(QUIZ_STATUS_KEY[quiz.status])}</span>
                    </td>
                    <td className="table-col-secondary">{quiz.passingScorePercent === null ? t("quizzes.notSet") : `${quiz.passingScorePercent}%`}</td>
                    <td className="table-col-secondary">{quiz.attemptLimit === null ? t("quizzes.unlimitedAttempts") : quiz.attemptLimit}</td>
                    <td className="table-col-secondary">{t(REVEAL_POLICY_KEY[quiz.revealAnswersPolicy])}</td>
                    <td className="table-col-secondary">{formatDate(quiz.updatedAt)}</td>
                    <td>
                      <div className="row-actions">
                        <Link
                          className="ghost-button compact"
                          href={`/instructor/quizzes/${quiz.quizId}`}
                          aria-label={t("quizzes.manageActionLabel").replace("{quiz}", quiz.title)}
                        >
                          {t("quizzes.manageAction")}
                        </Link>
                        <ActionMenu label={t("common.moreActionsFor").replace("{item}", quiz.title)} items={quizActions(quiz)} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="pagination-controls" aria-label={t("pagination.pageLabel")}>
            <button
              className="secondary-button compact"
              type="button"
              onClick={() => setOffset((value) => previousOffset(value, QUIZZES_PAGE_SIZE))}
              disabled={!canGoPrevious(offset)}
            >
              {t("pagination.previous")}
            </button>
            <button
              className="secondary-button compact"
              type="button"
              onClick={() => setOffset((value) => nextOffset(value, QUIZZES_PAGE_SIZE))}
              disabled={!canGoNext(state.data.hasMore)}
            >
              {t("pagination.next")}
            </button>
          </div>
        </>
      )}

      {createOpen ? <CreateQuizDialog tenantId={tenant.tenantId} onClose={() => setCreateOpen(false)} /> : null}

      {lifecycleTarget ? (
        <QuizLifecycleConfirmDialog
          action={lifecycleTarget.action}
          tenantId={tenant.tenantId}
          quiz={lifecycleTarget.quiz}
          onClose={() => setLifecycleTarget(null)}
          onDone={() => {
            setLifecycleTarget(null);
            retry();
          }}
          onConflict={retry}
        />
      ) : null}
    </div>
  );
}
