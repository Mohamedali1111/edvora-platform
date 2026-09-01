"use client";

import { useState } from "react";
import { useAuthenticatedInstructorSession } from "@/features/instructor/session-context";
import { canGoNext, canGoPrevious, nextOffset, previousOffset } from "@/features/instructor/students/pagination";
import type { QuizAttemptStatus, QuizStatus } from "@/lib/api/types";
import { useI18n } from "@/lib/i18n/i18n";
import type { TranslationKey } from "@/lib/i18n/translations";
import { EntityPicker } from "./entity-picker";
import { isNetworkError } from "./error-mapping";
import { formatAttemptPercentage, formatAttemptScore, formatDateTime, presentPassFail } from "./format";
import { ENTITY_PICKER_PAGE_SIZE, QUIZ_RESULTS_PAGE_SIZE, useQuizAttempts, useQuizPicker, useStudentPicker } from "./progress-service";

const QUIZ_STATUS_KEY: Record<QuizStatus, TranslationKey> = {
  DRAFT: "status.quizDraft",
  PUBLISHED: "status.quizPublished",
  ARCHIVED: "status.quizArchived",
};

const ATTEMPT_STATUS_KEY: Record<QuizAttemptStatus, TranslationKey> = {
  IN_PROGRESS: "progress.attemptStatusInProgress",
  SUBMITTED: "progress.attemptStatusSubmitted",
  GRADED: "progress.attemptStatusGraded",
  ABANDONED: "progress.attemptStatusAbandoned",
};

type PassFilter = "ALL" | "PASSED" | "FAILED";

const PASS_FILTER_OPTIONS: PassFilter[] = ["ALL", "PASSED", "FAILED"];

const PASS_FILTER_KEY: Record<PassFilter, TranslationKey> = {
  ALL: "progress.passFilterAll",
  PASSED: "progress.passFilterPassed",
  FAILED: "progress.passFilterFailed",
};

const RESULT_BADGE: Record<ReturnType<typeof presentPassFail>, { className: string; labelKey: TranslationKey }> = {
  passed: { className: "status-badge-passed", labelKey: "progress.resultPassed" },
  failed: { className: "status-badge-failed", labelKey: "progress.resultFailed" },
  pending: { className: "status-badge-not-graded", labelKey: "progress.resultPending" },
};

/**
 * Quiz Results reporting - Slice G. Every score/percentage/passed value
 * rendered here is the backend's own historical grading snapshot (see
 * `InstructorQuizAttemptSummary` in lib/api/types.ts) - this panel never
 * reads or references the selected Quiz's *current* `passingScorePercent`.
 */
export function QuizResultsPanel() {
  const { tenant } = useAuthenticatedInstructorSession();
  const { t } = useI18n();
  const [selectedQuiz, setSelectedQuiz] = useState<{ quizId: string; title: string; status: QuizStatus } | null>(null);
  const [quizPickerOpen, setQuizPickerOpen] = useState(true);
  const [quizPickerOffset, setQuizPickerOffset] = useState(0);

  const [studentFilterOpen, setStudentFilterOpen] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState<{ userId: string; label: string } | null>(null);
  const [studentPickerOffset, setStudentPickerOffset] = useState(0);

  const [passFilter, setPassFilter] = useState<PassFilter>("ALL");
  const [offset, setOffset] = useState(0);

  const { state: quizPickerState, retry: retryQuizPicker } = useQuizPicker(tenant.tenantId, quizPickerOffset, quizPickerOpen);
  const { state: studentPickerState, retry: retryStudentPicker } = useStudentPicker(tenant.tenantId, studentPickerOffset, studentFilterOpen);
  const { state, retry } = useQuizAttempts(
    tenant.tenantId,
    selectedQuiz?.quizId ?? null,
    selectedStudent?.userId,
    passFilter === "ALL" ? undefined : passFilter === "PASSED",
    offset,
  );

  function handlePassFilterChange(value: PassFilter) {
    setPassFilter(value);
    setOffset(0);
  }

  function clearStudentFilter() {
    setSelectedStudent(null);
    setStudentFilterOpen(false);
    setOffset(0);
  }

  return (
    <div className="progress-panel">
      <div className="field">
        <span id="progress-quiz-picker-label">{t("progress.quizLabel")}</span>

        {!quizPickerOpen && selectedQuiz ? (
          <div className="entity-chip">
            <span className="entity-chip-title">{selectedQuiz.title}</span>
            <span className={`status-badge status-badge-${selectedQuiz.status.toLowerCase()}`}>{t(QUIZ_STATUS_KEY[selectedQuiz.status])}</span>
            <button
              className="ghost-button compact"
              type="button"
              onClick={() => setQuizPickerOpen(true)}
              aria-label={t("progress.changeQuizLabel").replace("{quiz}", selectedQuiz.title)}
            >
              {t("progress.changeAction")}
            </button>
          </div>
        ) : (
          <EntityPicker
            labelId="progress-quiz-picker-label"
            state={quizPickerState}
            retry={retryQuizPicker}
            offset={quizPickerOffset}
            onOffsetChange={setQuizPickerOffset}
            pageSize={ENTITY_PICKER_PAGE_SIZE}
            getId={(quiz) => quiz.quizId}
            selectedId={selectedQuiz?.quizId ?? null}
            onSelect={(quiz) => {
              setSelectedQuiz({ quizId: quiz.quizId, title: quiz.title, status: quiz.status });
              setQuizPickerOpen(false);
              setOffset(0);
            }}
            loadingErrorFallback="progress.pickerErrorLoad"
            emptyLabel="progress.quizSelectorEmpty"
            renderOption={(quiz) => (
              <>
                <span>{quiz.title}</span>
                <span className={`status-badge status-badge-${quiz.status.toLowerCase()}`}>{t(QUIZ_STATUS_KEY[quiz.status])}</span>
              </>
            )}
          />
        )}
      </div>

      {!selectedQuiz ? (
        <p className="overview-empty">{t("progress.noQuizSelected")}</p>
      ) : (
        <>
          <div className="progress-filter-row">
            <div className="field enrollment-filter">
              <label htmlFor="progress-pass-filter">{t("progress.passFilterLabel")}</label>
              <select id="progress-pass-filter" value={passFilter} onChange={(event) => handlePassFilterChange(event.target.value as PassFilter)}>
                {PASS_FILTER_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {t(PASS_FILTER_KEY[option])}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <span id="progress-student-picker-label">{t("progress.studentLabel")}</span>
              {selectedStudent ? (
                <div className="entity-chip">
                  <span className="entity-chip-title">{selectedStudent.label}</span>
                  <button
                    className="ghost-button compact"
                    type="button"
                    onClick={clearStudentFilter}
                    aria-label={t("progress.clearStudentFilterLabel").replace("{student}", selectedStudent.label)}
                  >
                    {t("progress.clearAction")}
                  </button>
                </div>
              ) : (
                <button className="secondary-button compact" type="button" aria-expanded={studentFilterOpen} onClick={() => setStudentFilterOpen((value) => !value)}>
                  {t("progress.studentFilterToggle")}
                </button>
              )}

              {studentFilterOpen && !selectedStudent ? (
                <EntityPicker
                  labelId="progress-student-picker-label"
                  state={studentPickerState}
                  retry={retryStudentPicker}
                  offset={studentPickerOffset}
                  onOffsetChange={setStudentPickerOffset}
                  pageSize={ENTITY_PICKER_PAGE_SIZE}
                  getId={(student) => student.userId}
                  selectedId={null}
                  onSelect={(student) => {
                    setSelectedStudent({ userId: student.userId, label: student.displayName ?? student.email });
                    setStudentFilterOpen(false);
                    setOffset(0);
                  }}
                  loadingErrorFallback="progress.pickerErrorLoad"
                  emptyLabel="progress.studentSelectorEmpty"
                  renderOption={(student) => <span>{student.displayName ?? student.email}</span>}
                />
              ) : null}
            </div>
          </div>

          {state.status === "idle" || state.status === "loading" ? (
            <p className="overview-loading" role="status">
              {t("overview.loading")}
            </p>
          ) : state.status === "error" ? (
            <div className="overview-error" role="alert">
              <p>{isNetworkError(state.error) ? t("shell.apiUnavailable") : t("progress.errorLoadResults")}</p>
              <button className="secondary-button compact-action" type="button" onClick={retry}>
                {t("shell.retry")}
              </button>
            </div>
          ) : state.data.items.length === 0 ? (
            <p className="overview-empty">{t("progress.resultsEmpty")}</p>
          ) : (
            <>
              <div className="table-scroll">
                <table className="data-table">
                  <caption className="sr-only">{t("progress.tabResults")}</caption>
                  <thead>
                    <tr>
                      <th scope="col">{t("progress.columnStudent")}</th>
                      <th scope="col">{t("progress.columnAttemptStatus")}</th>
                      <th scope="col">{t("progress.columnScore")}</th>
                      <th scope="col">{t("progress.columnResult")}</th>
                      <th scope="col" className="table-col-secondary">
                        {t("progress.columnAttemptNumber")}
                      </th>
                      <th scope="col" className="table-col-secondary">
                        {t("progress.columnStarted")}
                      </th>
                      <th scope="col" className="table-col-secondary">
                        {t("progress.columnSubmitted")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.data.items.map((attempt) => {
                      const result = RESULT_BADGE[presentPassFail(attempt.passed)];
                      return (
                        <tr key={attempt.attemptId}>
                          <td>
                            <strong>{attempt.student.displayName ?? attempt.student.email}</strong>
                            {attempt.student.displayName ? <span className="table-secondary-text">{attempt.student.email}</span> : null}
                          </td>
                          <td>
                            <span className={`status-badge status-badge-attempt-${attempt.status.toLowerCase().replace(/_/g, "-")}`}>{t(ATTEMPT_STATUS_KEY[attempt.status])}</span>
                          </td>
                          <td>
                            <span>{formatAttemptScore(attempt.scorePoints, attempt.maxPoints, t("progress.notGraded"))}</span>
                            <span className="table-secondary-text">{formatAttemptPercentage(attempt.percentage, t("progress.notGraded"))}</span>
                          </td>
                          <td>
                            <span className={`status-badge ${result.className}`}>{t(result.labelKey)}</span>
                          </td>
                          <td className="table-col-secondary">{attempt.attemptNumber}</td>
                          <td className="table-col-secondary">{formatDateTime(attempt.startedAt, "")}</td>
                          <td className="table-col-secondary">{formatDateTime(attempt.submittedAt, t("progress.notSubmitted"))}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="pagination-controls" aria-label={t("pagination.pageLabel")}>
                <button className="secondary-button compact" type="button" onClick={() => setOffset((value) => previousOffset(value, QUIZ_RESULTS_PAGE_SIZE))} disabled={!canGoPrevious(offset)}>
                  {t("pagination.previous")}
                </button>
                <button className="secondary-button compact" type="button" onClick={() => setOffset((value) => nextOffset(value, QUIZ_RESULTS_PAGE_SIZE))} disabled={!canGoNext(state.data.hasMore)}>
                  {t("pagination.next")}
                </button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
