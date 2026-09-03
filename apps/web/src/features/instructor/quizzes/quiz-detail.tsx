"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useAuthenticatedInstructorSession } from "@/features/instructor/session-context";
import { formatDate } from "@/features/instructor/students/format";
import { getAuthService } from "@/lib/api/session";
import type { QuestionOptionSummary, QuestionSummary, QuestionType, QuizRevealAnswersPolicy, QuizStatus } from "@/lib/api/types";
import { useI18n } from "@/lib/i18n/i18n";
import type { TranslationKey } from "@/lib/i18n/translations";
import { QuizMetadataFields } from "./create-quiz-dialog";
import { isNetworkError, isQuizLifecycleConflict, isQuizPublishabilityConflict, resolveErrorMessageKey } from "./error-mapping";
import {
  canArchiveQuiz,
  canCreateQuestion,
  canEditQuiz,
  canMutateOption,
  canMutateQuestion,
  canPublishQuiz,
  canReorderQuestion,
  canRestoreQuiz,
  canTakeQuizOffline,
  isQuizArchived,
} from "./lifecycle";
import { QuizLifecycleConfirmDialog, type QuizLifecycleAction } from "./lifecycle-confirm-dialog";
import { moveEarlier, moveLater, reorderableQuestionIds } from "./ordering";
import {
  createOption,
  createQuestion,
  reorderOptions,
  reorderQuestions,
  updateOption,
  updateQuestion,
  updateQuiz,
  useQuizAuthoringDetail,
} from "./quizzes-service";
import {
  buildOptionCreatePayload,
  buildOptionUpdatePayload,
  buildQuestionCreatePayload,
  buildQuestionUpdatePayload,
  buildQuizUpdatePayload,
  type QuizFormErrors,
} from "./validation";

const QUIZ_STATUS_KEY: Record<QuizStatus, TranslationKey> = {
  DRAFT: "status.quizDraft",
  PUBLISHED: "status.quizPublished",
  ARCHIVED: "status.quizArchived",
};

const QUESTION_TYPE_KEY: Record<QuestionType, TranslationKey> = {
  MULTIPLE_CHOICE: "quizzes.typeMultipleChoice",
  TRUE_FALSE: "quizzes.typeTrueFalse",
};

const QUESTION_STATUS_KEY: Record<QuestionSummary["status"], TranslationKey> = {
  ACTIVE: "status.questionActive",
  ARCHIVED: "status.questionArchived",
};

const REVEAL_POLICY_KEY: Record<QuizRevealAnswersPolicy, TranslationKey> = {
  NEVER: "quizzes.revealNever",
  AFTER_SUBMISSION: "quizzes.revealAfterSubmission",
  AFTER_PASSING: "quizzes.revealAfterPassing",
};

const LIFECYCLE_SUCCESS_KEY: Record<QuizLifecycleAction, TranslationKey> = {
  publish: "quizzes.publishSuccess",
  takeOffline: "quizzes.takeOfflineSuccess",
  archive: "quizzes.archiveSuccess",
  restore: "quizzes.restoreSuccess",
};

type PendingState = {
  metadata?: boolean;
  questionCreate?: boolean;
  questionId?: string;
  questionReorder?: boolean;
  optionCreateQuestionId?: string;
  optionId?: string;
  optionCorrectId?: string;
  optionReorderQuestionId?: string;
};

export function QuizDetail({ quizId }: { quizId: string }) {
  const { tenant } = useAuthenticatedInstructorSession();
  const { t } = useI18n();
  const { state, retry, replaceQuiz } = useQuizAuthoringDetail(tenant.tenantId, quizId);
  const [success, setSuccess] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingState>({});
  const [dialog, setDialog] = useState<QuizLifecycleAction | null>(null);

  function showMutationError(error: unknown, fallback: TranslationKey) {
    if (isNetworkError(error)) {
      setPageError(t("shell.apiUnavailable"));
    } else {
      setPageError(t(resolveErrorMessageKey(error, fallback)));
    }

    if (isQuizLifecycleConflict(error) || isQuizPublishabilityConflict(error)) {
      retry();
    }
  }

  function afterMutation(messageKey: TranslationKey, refetch = true) {
    setPageError(null);
    setSuccess(t(messageKey));
    if (refetch) {
      retry();
    }
  }

  if (state.status === "loading") {
    return (
      <div className="detail-page quizzes-page">
        <p className="overview-loading" role="status">
          {t("overview.loading")}
        </p>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="detail-page quizzes-page">
        <Link className="back-link" href="/instructor/quizzes">
          <span className="back-arrow" aria-hidden="true" />
          {t("quizzes.detailBack")}
        </Link>
        <div className="overview-error" role="alert">
          <p>{isNetworkError(state.error) ? t("shell.apiUnavailable") : t("quizzes.detailGenericError")}</p>
          <button className="secondary-button compact-action" type="button" onClick={retry}>
            {t("shell.retry")}
          </button>
        </div>
      </div>
    );
  }

  const { quiz, questions, optionsByQuestionId } = state.data;
  const editable = canEditQuiz(quiz.status);
  const archived = isQuizArchived(quiz.status);

  return (
    <div className="detail-page quizzes-page">
      <Link className="back-link" href="/instructor/quizzes">
        <span className="back-arrow" aria-hidden="true" />
        {t("quizzes.detailBack")}
      </Link>

      <div className="detail-header">
        <h2>{quiz.title}</h2>
        <span className={`status-badge status-badge-${quiz.status.toLowerCase()}`}>{t(QUIZ_STATUS_KEY[quiz.status])}</span>
      </div>

      {archived ? <div className="archived-banner">{t("quizzes.archivedReadOnlyBanner")}</div> : null}

      <dl className="detail-grid">
        <div>
          <dt>{t("quizzes.detailStatusLabel")}</dt>
          <dd>{t(QUIZ_STATUS_KEY[quiz.status])}</dd>
        </div>
        <div>
          <dt>{t("quizzes.passingScoreLabel")}</dt>
          <dd>{quiz.passingScorePercent === null ? t("quizzes.notSet") : `${quiz.passingScorePercent}%`}</dd>
        </div>
        <div>
          <dt>{t("quizzes.attemptLimitLabel")}</dt>
          <dd>{quiz.attemptLimit === null ? t("quizzes.unlimitedAttempts") : quiz.attemptLimit}</dd>
        </div>
        <div>
          <dt>{t("quizzes.revealPolicyLabel")}</dt>
          <dd>{t(REVEAL_POLICY_KEY[quiz.revealAnswersPolicy])}</dd>
        </div>
        <div>
          <dt>{t("quizzes.detailCreatedLabel")}</dt>
          <dd>{formatDate(quiz.createdAt)}</dd>
        </div>
        <div>
          <dt>{t("quizzes.detailUpdatedLabel")}</dt>
          <dd>{formatDate(quiz.updatedAt)}</dd>
        </div>
      </dl>

      {pageError ? (
        <div className="form-error" role="alert">
          {pageError}
        </div>
      ) : null}
      {success ? (
        <div className="form-success" role="status">
          {success}
        </div>
      ) : null}

      <QuizMetadataPanel
        quiz={quiz}
        editable={editable}
        pending={pending.metadata === true}
        onSubmit={async (payload) => {
          if (pending.metadata) {
            return;
          }
          setPending({ metadata: true });
          try {
            const updated = await updateQuiz(getAuthService().getClient(), tenant.tenantId, quiz.quizId, payload);
            replaceQuiz(updated);
            afterMutation("quizzes.saveSuccess", false);
          } catch (error) {
            showMutationError(error, "quizzes.saveErrorGeneric");
          } finally {
            setPending({});
          }
        }}
      />

      <QuizQuestionsPanel
        tenantId={tenant.tenantId}
        quiz={quiz}
        questions={questions}
        optionsByQuestionId={optionsByQuestionId}
        pending={pending}
        setPending={setPending}
        onError={showMutationError}
        onSuccess={afterMutation}
      />

      <section className="detail-section quiz-lifecycle-panel" aria-labelledby="quiz-lifecycle-heading">
        <div className="detail-section-header">
          <h2 id="quiz-lifecycle-heading">{t("quizzes.lifecycleHeading")}</h2>
        </div>
        <PublishRequirements quiz={quiz} questions={questions} optionsByQuestionId={optionsByQuestionId} />
        <div className="section-row-actions quiz-lifecycle-actions">
          {canPublishQuiz(quiz.status) ? (
            <button className="primary-button compact" type="button" onClick={() => setDialog("publish")}>
              {t("quizzes.publishAction")}
            </button>
          ) : null}
          {canTakeQuizOffline(quiz.status) ? (
            <button className="secondary-button compact" type="button" onClick={() => setDialog("takeOffline")}>
              {t("quizzes.takeOfflineAction")}
            </button>
          ) : null}
          {canArchiveQuiz(quiz.status) ? (
            <button className="primary-button danger-button compact" type="button" onClick={() => setDialog("archive")}>
              {t("quizzes.archiveAction")}
            </button>
          ) : null}
          {canRestoreQuiz(quiz.status) ? (
            <button className="primary-button compact" type="button" onClick={() => setDialog("restore")}>
              {t("quizzes.restoreAction")}
            </button>
          ) : null}
          {archived ? <p className="form-note">{t("quizzes.archivedTerminalNote")}</p> : null}
        </div>
      </section>

      {dialog ? (
        <QuizLifecycleConfirmDialog
          action={dialog}
          tenantId={tenant.tenantId}
          quiz={quiz}
          onClose={() => setDialog(null)}
          onDone={(updated) => {
            setDialog(null);
            // `updated` is the mutation's own response - already the
            // authoritative, backend-committed row. Apply it directly and
            // do NOT also force a refetch here (`afterMutation(..., false)`):
            // a redundant retry() would discard this fresh, correct status
            // and re-run the full question/option fan-out, and any transient
            // failure in that larger fetch would then mask the successful
            // publish/archive/take-offline/restore as stale state - see
            // quizzes-service.ts#applyQuizLifecycleResult and
            // docs referenced there. A refetch remains correct - and still
            // happens, via onConflict below - only when the mutation itself
            // reports the local state was actually wrong.
            replaceQuiz(updated);
            afterMutation(LIFECYCLE_SUCCESS_KEY[dialog], false);
          }}
          onConflict={retry}
        />
      ) : null}
    </div>
  );
}

function QuizMetadataPanel({
  quiz,
  editable,
  pending,
  onSubmit,
}: {
  quiz: import("@/lib/api/types").QuizSummary;
  editable: boolean;
  pending: boolean;
  onSubmit: (payload: import("@/lib/api/types").UpdateQuizRequest) => Promise<void>;
}) {
  const { t } = useI18n();
  const [title, setTitle] = useState(quiz.title);
  const [description, setDescription] = useState(quiz.description ?? "");
  const [passingScorePercent, setPassingScorePercent] = useState(quiz.passingScorePercent ?? "");
  const [attemptLimit, setAttemptLimit] = useState(quiz.attemptLimit === null ? "" : String(quiz.attemptLimit));
  const [revealAnswersPolicy, setRevealAnswersPolicy] = useState<QuizRevealAnswersPolicy>(quiz.revealAnswersPolicy);
  const [errors, setErrors] = useState<QuizFormErrors>({});
  const trackedUpdatedAt = useRef(quiz.updatedAt);

  useEffect(() => {
    if (trackedUpdatedAt.current !== quiz.updatedAt) {
      trackedUpdatedAt.current = quiz.updatedAt;
      setTitle(quiz.title);
      setDescription(quiz.description ?? "");
      setPassingScorePercent(quiz.passingScorePercent ?? "");
      setAttemptLimit(quiz.attemptLimit === null ? "" : String(quiz.attemptLimit));
      setRevealAnswersPolicy(quiz.revealAnswersPolicy);
      setErrors({});
    }
  }, [quiz]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = buildQuizUpdatePayload({ title, description, passingScorePercent, attemptLimit, revealAnswersPolicy });
    setErrors(result.errors);

    if (result.payload) {
      await onSubmit(result.payload);
    }
  }

  return (
    <section className="detail-section" aria-labelledby="quiz-metadata-heading">
      <div className="detail-section-header">
        <h2 id="quiz-metadata-heading">{t("quizzes.editHeading")}</h2>
      </div>
      {editable ? (
        <form className="quiz-form" onSubmit={submit} noValidate>
          <QuizMetadataFields
            prefix="edit"
            title={title}
            description={description}
            passingScorePercent={passingScorePercent}
            attemptLimit={attemptLimit}
            revealAnswersPolicy={revealAnswersPolicy}
            errors={errors}
            disabled={pending}
            onTitleChange={setTitle}
            onDescriptionChange={setDescription}
            onPassingScorePercentChange={setPassingScorePercent}
            onAttemptLimitChange={setAttemptLimit}
            onRevealAnswersPolicyChange={setRevealAnswersPolicy}
          />
          <button className="primary-button compact" type="submit" disabled={pending}>
            {pending ? t("quizzes.saving") : t("quizzes.saveAction")}
          </button>
        </form>
      ) : (
        <p className="form-note">{quiz.description || t("quizzes.descriptionEmptyNote")}</p>
      )}
    </section>
  );
}

function QuizQuestionsPanel({
  tenantId,
  quiz,
  questions,
  optionsByQuestionId,
  pending,
  setPending,
  onError,
  onSuccess,
}: {
  tenantId: string;
  quiz: import("@/lib/api/types").QuizSummary;
  questions: QuestionSummary[];
  optionsByQuestionId: Record<string, QuestionOptionSummary[]>;
  pending: PendingState;
  setPending: (value: PendingState) => void;
  onError: (error: unknown, fallback: TranslationKey) => void;
  onSuccess: (messageKey: TranslationKey) => void;
}) {
  const { t } = useI18n();
  const client = getAuthService().getClient();
  const order = reorderableQuestionIds(quiz.status, questions);

  async function moveQuestion(questionId: string, direction: "earlier" | "later") {
    const next = direction === "earlier" ? moveEarlier(order, questionId) : moveLater(order, questionId);
    if (!next || pending.questionReorder) {
      return;
    }

    setPending({ questionReorder: true });
    try {
      await reorderQuestions(client, tenantId, quiz.quizId, { questionIds: next });
      onSuccess("quizzes.reorderSuccess");
    } catch (error) {
      onError(error, "quizzes.reorderErrorGeneric");
    } finally {
      setPending({});
    }
  }

  return (
    <section className="detail-section quiz-authoring-panel" aria-labelledby="quiz-questions-heading">
      <div className="detail-section-header">
        <h2 id="quiz-questions-heading">{t("quizzes.questionsHeading")}</h2>
      </div>
      {canCreateQuestion(quiz.status) ? (
        <CreateQuestionForm
          disabled={pending.questionCreate === true}
          onSubmit={async (payload) => {
            if (pending.questionCreate) {
              return;
            }
            setPending({ questionCreate: true });
            try {
              await createQuestion(client, tenantId, quiz.quizId, payload);
              onSuccess("quizzes.questionCreateSuccess");
            } catch (error) {
              onError(error, "quizzes.questionCreateErrorGeneric");
            } finally {
              setPending({});
            }
          }}
        />
      ) : quiz.status === "PUBLISHED" ? (
        <p className="form-note">{t("quizzes.publishedQuestionCreateNote")}</p>
      ) : null}

      {questions.length === 0 ? (
        <p className="overview-empty">{t("quizzes.questionsEmpty")}</p>
      ) : (
        <ol className="quiz-question-list">
          {questions.map((question, index) => (
            <li className="quiz-question-item" key={question.questionId}>
              <QuestionEditor
                key={`${question.questionId}:${question.updatedAt}`}
                tenantId={tenantId}
                quiz={quiz}
                question={question}
                options={optionsByQuestionId[question.questionId] ?? []}
                index={index}
                order={order}
                pending={pending}
                onMoveEarlier={() => moveQuestion(question.questionId, "earlier")}
                onMoveLater={() => moveQuestion(question.questionId, "later")}
                onError={onError}
                onSuccess={onSuccess}
                setPending={setPending}
              />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function CreateQuestionForm({ disabled, onSubmit }: { disabled: boolean; onSubmit: (payload: import("@/lib/api/types").CreateQuestionRequest) => Promise<void> }) {
  const { t } = useI18n();
  const [type, setType] = useState<QuestionType>("MULTIPLE_CHOICE");
  const [prompt, setPrompt] = useState("");
  const [points, setPoints] = useState("1");
  const [errors, setErrors] = useState<{ prompt?: "required" | "tooLong"; points?: "required" | "invalid" | "tooSmall" | "tooLarge" }>({});

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = buildQuestionCreatePayload({ type, prompt, points });
    setErrors(result.errors);

    if (result.payload) {
      await onSubmit(result.payload);
      setPrompt("");
      setPoints("1");
    }
  }

  return (
    <form className="quiz-inline-form" onSubmit={submit} noValidate>
      <div className="quiz-form-grid">
        <div className="field">
          <label htmlFor="new-question-type">{t("quizzes.questionTypeLabel")}</label>
          <select id="new-question-type" value={type} disabled={disabled} onChange={(event) => setType(event.target.value as QuestionType)}>
            <option value="MULTIPLE_CHOICE">{t("quizzes.typeMultipleChoice")}</option>
            <option value="TRUE_FALSE">{t("quizzes.typeTrueFalse")}</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="new-question-points">{t("quizzes.pointsLabel")}</label>
          <input id="new-question-points" type="text" inputMode="decimal" value={points} disabled={disabled} onChange={(event) => setPoints(event.target.value)} />
          {errors.points ? <p className="field-error">{t("quizzes.pointsInvalid")}</p> : null}
        </div>
      </div>
      <div className="field">
        <label htmlFor="new-question-prompt">{t("quizzes.promptLabel")}</label>
        <textarea id="new-question-prompt" rows={3} maxLength={5000} value={prompt} disabled={disabled} onChange={(event) => setPrompt(event.target.value)} />
        {errors.prompt ? <p className="field-error">{errors.prompt === "required" ? t("quizzes.promptRequired") : t("quizzes.promptTooLong")}</p> : null}
      </div>
      <button className="secondary-button compact" type="submit" disabled={disabled}>
        {disabled ? t("quizzes.questionCreating") : t("quizzes.questionCreateAction")}
      </button>
    </form>
  );
}

function QuestionEditor({
  tenantId,
  quiz,
  question,
  options,
  index,
  order,
  pending,
  onMoveEarlier,
  onMoveLater,
  onError,
  onSuccess,
  setPending,
}: {
  tenantId: string;
  quiz: import("@/lib/api/types").QuizSummary;
  question: QuestionSummary;
  options: QuestionOptionSummary[];
  index: number;
  order: string[];
  pending: PendingState;
  onMoveEarlier: () => void;
  onMoveLater: () => void;
  onError: (error: unknown, fallback: TranslationKey) => void;
  onSuccess: (messageKey: TranslationKey) => void;
  setPending: (value: PendingState) => void;
}) {
  const { t } = useI18n();
  const [prompt, setPrompt] = useState(question.prompt);
  const [points, setPoints] = useState(question.points);
  const [errors, setErrors] = useState<{ prompt?: "required" | "tooLong"; points?: "required" | "invalid" | "tooSmall" | "tooLarge" }>({});
  const client = getAuthService().getClient();
  const editable = canMutateQuestion(quiz.status, question.status);
  const reorderable = canReorderQuestion(quiz.status, question.status);
  const questionPending = pending.questionId === question.questionId;
  const currentIndex = order.indexOf(question.questionId);
  const questionContext = String(index + 1);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (questionPending) {
      return;
    }

    const result = buildQuestionUpdatePayload({ prompt, points });
    setErrors(result.errors);

    if (!result.payload) {
      return;
    }

    setPending({ questionId: question.questionId });
    try {
      await updateQuestion(client, tenantId, quiz.quizId, question.questionId, result.payload);
      onSuccess("quizzes.questionUpdateSuccess");
    } catch (error) {
      onError(error, "quizzes.questionUpdateErrorGeneric");
    } finally {
      setPending({});
    }
  }

  return (
    <article className="quiz-question-row" aria-labelledby={`question-${question.questionId}-heading`}>
      <div className="quiz-question-header">
        <div className="quiz-question-title">
          <span className="quiz-position">{index + 1}</span>
          <div>
            <h3 id={`question-${question.questionId}-heading`}>{t(QUESTION_TYPE_KEY[question.type])}</h3>
            <p className="form-note">
              {t("quizzes.pointsValue").replace("{points}", question.points)} · {t(QUESTION_STATUS_KEY[question.status])}
            </p>
          </div>
        </div>
        <div className="section-row-actions">
          <button
            className="ghost-button compact"
            type="button"
            onClick={onMoveEarlier}
            disabled={!reorderable || currentIndex <= 0 || pending.questionReorder}
            aria-label={t("quizzes.moveQuestionEarlierLabel").replace("{question}", questionContext)}
          >
            {t("quizzes.moveEarlierAction")}
          </button>
          <button
            className="ghost-button compact"
            type="button"
            onClick={onMoveLater}
            disabled={!reorderable || currentIndex === -1 || currentIndex >= order.length - 1 || pending.questionReorder}
            aria-label={t("quizzes.moveQuestionLaterLabel").replace("{question}", questionContext)}
          >
            {t("quizzes.moveLaterAction")}
          </button>
        </div>
      </div>

      {editable ? (
        <form className="quiz-question-edit" onSubmit={submit} noValidate>
          <div className="field">
            <label htmlFor={`question-${question.questionId}-prompt`}>{t("quizzes.promptLabel")}</label>
            <textarea
              id={`question-${question.questionId}-prompt`}
              rows={3}
              maxLength={5000}
              value={prompt}
              disabled={questionPending}
              onChange={(event) => setPrompt(event.target.value)}
            />
            {errors.prompt ? <p className="field-error">{errors.prompt === "required" ? t("quizzes.promptRequired") : t("quizzes.promptTooLong")}</p> : null}
          </div>
          <div className="quiz-form-grid compact-grid">
            <div className="field">
              <label htmlFor={`question-${question.questionId}-points`}>{t("quizzes.pointsLabel")}</label>
              <input
                id={`question-${question.questionId}-points`}
                type="text"
                inputMode="decimal"
                value={points}
                disabled={questionPending}
                onChange={(event) => setPoints(event.target.value)}
              />
              {errors.points ? <p className="field-error">{t("quizzes.pointsInvalid")}</p> : null}
            </div>
            <div className="quiz-save-cell">
              <button className="secondary-button compact" type="submit" disabled={questionPending} aria-label={t("quizzes.saveQuestionLabel").replace("{question}", questionContext)}>
                {questionPending ? t("quizzes.saving") : t("quizzes.saveQuestionAction")}
              </button>
            </div>
          </div>
        </form>
      ) : (
        <p className="quiz-prompt-readonly">{question.prompt}</p>
      )}

      <OptionsEditor
        tenantId={tenantId}
        quiz={quiz}
        question={question}
        questionIndex={index}
        options={options}
        pending={pending}
        setPending={setPending}
        onError={onError}
        onSuccess={onSuccess}
      />
    </article>
  );
}

function OptionsEditor({
  tenantId,
  quiz,
  question,
  questionIndex,
  options,
  pending,
  setPending,
  onError,
  onSuccess,
}: {
  tenantId: string;
  quiz: import("@/lib/api/types").QuizSummary;
  question: QuestionSummary;
  questionIndex: number;
  options: QuestionOptionSummary[];
  pending: PendingState;
  setPending: (value: PendingState) => void;
  onError: (error: unknown, fallback: TranslationKey) => void;
  onSuccess: (messageKey: TranslationKey) => void;
}) {
  const { t } = useI18n();
  const client = getAuthService().getClient();
  const editable = canMutateOption(quiz.status, question.status);
  const order = options.map((option) => option.optionId);

  async function selectCorrect(optionId: string) {
    if (!editable || pending.optionCorrectId) {
      return;
    }

    setPending({ optionCorrectId: optionId });
    try {
      await updateOption(client, tenantId, quiz.quizId, question.questionId, optionId, { isCorrect: true });
      onSuccess("quizzes.correctAnswerSuccess");
    } catch (error) {
      onError(error, "quizzes.optionUpdateErrorGeneric");
    } finally {
      setPending({});
    }
  }

  async function clearCorrect(optionId: string) {
    if (!editable || pending.optionCorrectId) {
      return;
    }

    setPending({ optionCorrectId: optionId });
    try {
      await updateOption(client, tenantId, quiz.quizId, question.questionId, optionId, { isCorrect: false });
      onSuccess("quizzes.correctAnswerCleared");
    } catch (error) {
      onError(error, "quizzes.optionUpdateErrorGeneric");
    } finally {
      setPending({});
    }
  }

  async function moveOption(optionId: string, direction: "earlier" | "later") {
    const next = direction === "earlier" ? moveEarlier(order, optionId) : moveLater(order, optionId);
    if (!next || pending.optionReorderQuestionId) {
      return;
    }

    setPending({ optionReorderQuestionId: question.questionId });
    try {
      await reorderOptions(client, tenantId, quiz.quizId, question.questionId, { optionIds: next });
      onSuccess("quizzes.reorderSuccess");
    } catch (error) {
      onError(error, "quizzes.reorderErrorGeneric");
    } finally {
      setPending({});
    }
  }

  return (
    <div className="quiz-options-block">
      <div className="quiz-options-heading">
        <h4>{t("quizzes.optionsHeading")}</h4>
        {question.type === "TRUE_FALSE" ? <p className="form-note">{t("quizzes.trueFalseOptionNote")}</p> : <p className="form-note">{t("quizzes.multipleChoiceOptionNote")}</p>}
      </div>

      {editable ? (
        <CreateOptionForm
          question={question}
          questionIndex={questionIndex}
          disabled={pending.optionCreateQuestionId === question.questionId}
          onSubmit={async (payload) => {
            if (pending.optionCreateQuestionId) {
              return;
            }
            setPending({ optionCreateQuestionId: question.questionId });
            try {
              await createOption(client, tenantId, quiz.quizId, question.questionId, payload);
              onSuccess("quizzes.optionCreateSuccess");
            } catch (error) {
              onError(error, "quizzes.optionCreateErrorGeneric");
            } finally {
              setPending({});
            }
          }}
        />
      ) : null}

      {options.length === 0 ? (
        <p className="overview-empty">{t("quizzes.optionsEmpty")}</p>
      ) : (
        <fieldset className="quiz-option-fieldset">
          <legend className="sr-only">{t("quizzes.correctAnswerGroupLabel").replace("{question}", String(questionIndex + 1))}</legend>
          <ol className="quiz-option-list">
            {options.map((option, index) => (
              <li className="quiz-option-item" key={option.optionId}>
                <OptionEditor
                  key={`${option.optionId}:${option.updatedAt}`}
                  tenantId={tenantId}
                  quiz={quiz}
                  question={question}
                  questionIndex={questionIndex}
                  option={option}
                  index={index}
                  order={order}
                  editable={editable}
                  pending={pending}
                  onSelectCorrect={selectCorrect}
                  onClearCorrect={clearCorrect}
                  onMoveEarlier={() => moveOption(option.optionId, "earlier")}
                  onMoveLater={() => moveOption(option.optionId, "later")}
                  onError={onError}
                  onSuccess={onSuccess}
                  setPending={setPending}
                />
              </li>
            ))}
          </ol>
        </fieldset>
      )}
    </div>
  );
}

function CreateOptionForm({
  question,
  questionIndex,
  disabled,
  onSubmit,
}: {
  question: QuestionSummary;
  questionIndex: number;
  disabled: boolean;
  onSubmit: (payload: import("@/lib/api/types").CreateQuestionOptionRequest) => Promise<void>;
}) {
  const { t } = useI18n();
  const [label, setLabel] = useState("");
  const [text, setText] = useState("");
  const [isCorrect, setIsCorrect] = useState(false);
  const [errors, setErrors] = useState<{ label?: "tooLong"; text?: "required" | "tooLong" }>({});

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = buildOptionCreatePayload({ label, text, isCorrect });
    setErrors(result.errors);

    if (result.payload) {
      await onSubmit(result.payload);
      setLabel("");
      setText("");
      setIsCorrect(false);
    }
  }

  return (
    <form className="quiz-inline-form option-create-form" onSubmit={submit} noValidate>
      <div className="quiz-form-grid">
        <div className="field">
          <label htmlFor={`option-${question.questionId}-label`}>{t("quizzes.optionLabelLabel")}</label>
          <input id={`option-${question.questionId}-label`} type="text" maxLength={40} value={label} disabled={disabled} onChange={(event) => setLabel(event.target.value)} />
          {errors.label ? <p className="field-error">{t("quizzes.optionLabelTooLong")}</p> : null}
        </div>
        <div className="field checkbox-field">
          <label>
            <input
              type="checkbox"
              checked={isCorrect}
              disabled={disabled}
              aria-label={t("quizzes.markNewOptionCorrectLabel").replace("{question}", String(questionIndex + 1))}
              onChange={(event) => setIsCorrect(event.target.checked)}
            />
            {t("quizzes.markCorrectOnCreate")}
          </label>
        </div>
      </div>
      <div className="field">
        <label htmlFor={`option-${question.questionId}-text`}>{t("quizzes.optionTextLabel")}</label>
        <textarea id={`option-${question.questionId}-text`} rows={2} maxLength={5000} value={text} disabled={disabled} onChange={(event) => setText(event.target.value)} />
        {errors.text ? <p className="field-error">{errors.text === "required" ? t("quizzes.optionTextRequired") : t("quizzes.optionTextTooLong")}</p> : null}
      </div>
      <button className="secondary-button compact" type="submit" disabled={disabled} aria-label={t("quizzes.addOptionToQuestionLabel").replace("{question}", String(questionIndex + 1))}>
        {disabled ? t("quizzes.optionCreating") : t("quizzes.optionCreateAction")}
      </button>
    </form>
  );
}

function OptionEditor({
  tenantId,
  quiz,
  question,
  questionIndex,
  option,
  index,
  order,
  editable,
  pending,
  onSelectCorrect,
  onClearCorrect,
  onMoveEarlier,
  onMoveLater,
  onError,
  onSuccess,
  setPending,
}: {
  tenantId: string;
  quiz: import("@/lib/api/types").QuizSummary;
  question: QuestionSummary;
  questionIndex: number;
  option: QuestionOptionSummary;
  index: number;
  order: string[];
  editable: boolean;
  pending: PendingState;
  onSelectCorrect: (optionId: string) => Promise<void>;
  onClearCorrect: (optionId: string) => Promise<void>;
  onMoveEarlier: () => void;
  onMoveLater: () => void;
  onError: (error: unknown, fallback: TranslationKey) => void;
  onSuccess: (messageKey: TranslationKey) => void;
  setPending: (value: PendingState) => void;
}) {
  const { t } = useI18n();
  const [label, setLabel] = useState(option.label ?? "");
  const [text, setText] = useState(option.text);
  const [errors, setErrors] = useState<{ label?: "tooLong"; text?: "required" | "tooLong" }>({});
  const client = getAuthService().getClient();
  const optionPending = pending.optionId === option.optionId;
  const currentIndex = order.indexOf(option.optionId);
  const questionContext = String(questionIndex + 1);
  const optionContext = option.label?.trim() || t("quizzes.optionPosition").replace("{position}", String(index + 1));

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editable || optionPending) {
      return;
    }

    const result = buildOptionUpdatePayload({ label, text });
    setErrors(result.errors);

    if (!result.payload) {
      return;
    }

    setPending({ optionId: option.optionId });
    try {
      await updateOption(client, tenantId, quiz.quizId, question.questionId, option.optionId, result.payload);
      onSuccess("quizzes.optionUpdateSuccess");
    } catch (error) {
      onError(error, "quizzes.optionUpdateErrorGeneric");
    } finally {
      setPending({});
    }
  }

  return (
    <div className="quiz-option-row">
      <div className="quiz-option-correct">
        <input
          id={`option-${option.optionId}-correct`}
          type="radio"
          name={`correct-${question.questionId}`}
          checked={option.isCorrect}
          disabled={!editable || pending.optionCorrectId !== undefined}
          aria-label={(option.isCorrect ? t("quizzes.correctOptionRadioLabel") : t("quizzes.markOptionCorrectLabel"))
            .replace("{option}", optionContext)
            .replace("{question}", questionContext)}
          onChange={(event) => {
            if (event.target.checked && !option.isCorrect) {
              void onSelectCorrect(option.optionId);
            }
          }}
        />
        <label htmlFor={`option-${option.optionId}-correct`}>
          {option.isCorrect ? t("quizzes.correctAnswer") : t("quizzes.markCorrectAction")}
        </label>
      </div>

      <form className="quiz-option-edit" onSubmit={submit} noValidate>
        <div className="quiz-form-grid compact-grid">
          <div className="field">
            <label htmlFor={`option-${option.optionId}-label`}>{t("quizzes.optionLabelLabel")}</label>
            <input
              id={`option-${option.optionId}-label`}
              type="text"
              maxLength={40}
              value={label}
              disabled={!editable || optionPending}
              onChange={(event) => setLabel(event.target.value)}
            />
            {errors.label ? <p className="field-error">{t("quizzes.optionLabelTooLong")}</p> : null}
          </div>
          <div className="quiz-save-cell">
            <button
              className="secondary-button compact"
              type="submit"
              disabled={!editable || optionPending}
              aria-label={t("quizzes.saveOptionLabel").replace("{option}", optionContext).replace("{question}", questionContext)}
            >
              {optionPending ? t("quizzes.saving") : t("quizzes.saveOptionAction")}
            </button>
          </div>
        </div>
        <div className="field">
          <label htmlFor={`option-${option.optionId}-text`}>{t("quizzes.optionTextLabel")}</label>
          <textarea
            id={`option-${option.optionId}-text`}
            rows={2}
            maxLength={5000}
            value={text}
            disabled={!editable || optionPending}
            onChange={(event) => setText(event.target.value)}
          />
          {errors.text ? <p className="field-error">{errors.text === "required" ? t("quizzes.optionTextRequired") : t("quizzes.optionTextTooLong")}</p> : null}
        </div>
      </form>

      <div className="section-row-actions quiz-option-actions">
        <button
          className="ghost-button compact"
          type="button"
          onClick={onMoveEarlier}
          disabled={!editable || currentIndex <= 0 || pending.optionReorderQuestionId !== undefined}
          aria-label={t("quizzes.moveOptionEarlierLabel").replace("{option}", optionContext).replace("{question}", questionContext)}
        >
          {t("quizzes.moveEarlierAction")}
        </button>
        <button
          className="ghost-button compact"
          type="button"
          onClick={onMoveLater}
          disabled={!editable || currentIndex === -1 || currentIndex >= order.length - 1 || pending.optionReorderQuestionId !== undefined}
          aria-label={t("quizzes.moveOptionLaterLabel").replace("{option}", optionContext).replace("{question}", questionContext)}
        >
          {t("quizzes.moveLaterAction")}
        </button>
        {quiz.status === "DRAFT" && option.isCorrect ? (
          <button
            className="ghost-button compact"
            type="button"
            onClick={() => void onClearCorrect(option.optionId)}
            disabled={!editable || pending.optionCorrectId !== undefined}
            aria-label={t("quizzes.clearCorrectOptionLabel").replace("{option}", optionContext).replace("{question}", questionContext)}
          >
            {t("quizzes.clearCorrectAction")}
          </button>
        ) : null}
        <span className="form-note">{t("quizzes.optionPosition").replace("{position}", String(index + 1))}</span>
      </div>
    </div>
  );
}

function PublishRequirements({
  quiz,
  questions,
  optionsByQuestionId,
}: {
  quiz: import("@/lib/api/types").QuizSummary;
  questions: QuestionSummary[];
  optionsByQuestionId: Record<string, QuestionOptionSummary[]>;
}) {
  const { t } = useI18n();
  const activeQuestions = questions.filter((question) => question.status === "ACTIVE");
  const allQuestionsHaveOptions = activeQuestions.every((question) => {
    const count = (optionsByQuestionId[question.questionId] ?? []).length;
    return question.type === "TRUE_FALSE" ? count === 2 : count >= 2;
  });
  const allQuestionsHaveOneCorrect = activeQuestions.every((question) => (optionsByQuestionId[question.questionId] ?? []).filter((option) => option.isCorrect).length === 1);
  const allPointsPositive = activeQuestions.every((question) => Number(question.points) > 0);

  return (
    <div className="quiz-publish-checklist">
      <p className="form-note">{quiz.status === "DRAFT" ? t("quizzes.publishRequirementsIntro") : t("quizzes.publishedEditNote")}</p>
      <ul>
        <li data-complete={activeQuestions.length > 0}>{t("quizzes.requirementQuestions")}</li>
        <li data-complete={allQuestionsHaveOptions}>{t("quizzes.requirementOptions")}</li>
        <li data-complete={allQuestionsHaveOneCorrect}>{t("quizzes.requirementCorrect")}</li>
        <li data-complete={allPointsPositive}>{t("quizzes.requirementPoints")}</li>
        <li data-complete="true">{t("quizzes.requirementMetadata")}</li>
      </ul>
    </div>
  );
}
