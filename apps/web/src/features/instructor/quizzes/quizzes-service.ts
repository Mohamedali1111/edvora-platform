"use client";

import { useEffect, useState } from "react";
import type { ApiClient } from "../../../lib/api/client";
import { getAuthService } from "../../../lib/api/session";
import type {
  CreateQuestionOptionRequest,
  CreateQuestionRequest,
  CreateQuizRequest,
  OffsetPage,
  QuestionListResponse,
  QuestionOptionListResponse,
  QuestionOptionSummary,
  QuestionSummary,
  QuizSummary,
  ReorderQuestionOptionsRequest,
  ReorderQuestionsRequest,
  UpdateQuestionOptionRequest,
  UpdateQuestionRequest,
  UpdateQuizRequest,
} from "../../../lib/api/types";

export const QUIZZES_PAGE_SIZE = 20;

export function listQuizzes(api: ApiClient, tenantId: string, params: { limit: number; offset: number }): Promise<OffsetPage<QuizSummary>> {
  return api.request<OffsetPage<QuizSummary>>(`/instructor/tenants/${tenantId}/quizzes?limit=${params.limit}&offset=${params.offset}`);
}

export function getQuiz(api: ApiClient, tenantId: string, quizId: string): Promise<QuizSummary> {
  return api.request<QuizSummary>(`/instructor/tenants/${tenantId}/quizzes/${quizId}`);
}

export function createQuiz(api: ApiClient, tenantId: string, body: CreateQuizRequest): Promise<QuizSummary> {
  return api.request<QuizSummary>(`/instructor/tenants/${tenantId}/quizzes`, { method: "POST", body });
}

export function updateQuiz(api: ApiClient, tenantId: string, quizId: string, body: UpdateQuizRequest): Promise<QuizSummary> {
  return api.request<QuizSummary>(`/instructor/tenants/${tenantId}/quizzes/${quizId}`, { method: "PATCH", body });
}

export function publishQuiz(api: ApiClient, tenantId: string, quizId: string): Promise<QuizSummary> {
  return api.request<QuizSummary>(`/instructor/tenants/${tenantId}/quizzes/${quizId}/publish`, { method: "POST" });
}

export function archiveQuiz(api: ApiClient, tenantId: string, quizId: string): Promise<QuizSummary> {
  return api.request<QuizSummary>(`/instructor/tenants/${tenantId}/quizzes/${quizId}/archive`, { method: "POST" });
}

export function listQuestions(api: ApiClient, tenantId: string, quizId: string): Promise<QuestionListResponse> {
  return api.request<QuestionListResponse>(`/instructor/tenants/${tenantId}/quizzes/${quizId}/questions`);
}

export function createQuestion(api: ApiClient, tenantId: string, quizId: string, body: CreateQuestionRequest): Promise<QuestionSummary> {
  return api.request<QuestionSummary>(`/instructor/tenants/${tenantId}/quizzes/${quizId}/questions`, { method: "POST", body });
}

export function updateQuestion(
  api: ApiClient,
  tenantId: string,
  quizId: string,
  questionId: string,
  body: UpdateQuestionRequest,
): Promise<QuestionSummary> {
  return api.request<QuestionSummary>(`/instructor/tenants/${tenantId}/quizzes/${quizId}/questions/${questionId}`, { method: "PATCH", body });
}

export function reorderQuestions(api: ApiClient, tenantId: string, quizId: string, body: ReorderQuestionsRequest): Promise<QuestionListResponse> {
  return api.request<QuestionListResponse>(`/instructor/tenants/${tenantId}/quizzes/${quizId}/questions/reorder`, { method: "POST", body });
}

export function listOptions(api: ApiClient, tenantId: string, quizId: string, questionId: string): Promise<QuestionOptionListResponse> {
  return api.request<QuestionOptionListResponse>(`/instructor/tenants/${tenantId}/quizzes/${quizId}/questions/${questionId}/options`);
}

export function createOption(
  api: ApiClient,
  tenantId: string,
  quizId: string,
  questionId: string,
  body: CreateQuestionOptionRequest,
): Promise<QuestionOptionSummary> {
  return api.request<QuestionOptionSummary>(`/instructor/tenants/${tenantId}/quizzes/${quizId}/questions/${questionId}/options`, {
    method: "POST",
    body,
  });
}

export function updateOption(
  api: ApiClient,
  tenantId: string,
  quizId: string,
  questionId: string,
  optionId: string,
  body: UpdateQuestionOptionRequest,
): Promise<QuestionOptionSummary> {
  return api.request<QuestionOptionSummary>(`/instructor/tenants/${tenantId}/quizzes/${quizId}/questions/${questionId}/options/${optionId}`, {
    method: "PATCH",
    body,
  });
}

export function reorderOptions(
  api: ApiClient,
  tenantId: string,
  quizId: string,
  questionId: string,
  body: ReorderQuestionOptionsRequest,
): Promise<QuestionOptionListResponse> {
  return api.request<QuestionOptionListResponse>(`/instructor/tenants/${tenantId}/quizzes/${quizId}/questions/${questionId}/options/reorder`, {
    method: "POST",
    body,
  });
}

export type QuizAuthoringDetail = {
  quiz: QuizSummary;
  questions: QuestionSummary[];
  optionsByQuestionId: Record<string, QuestionOptionSummary[]>;
};

/**
 * Applies a lifecycle/metadata mutation's own response - already the
 * authoritative, backend-committed row (see `publishQuiz`/`archiveQuiz`/
 * `updateQuiz` above, each a direct pass-through of the mutation's HTTP
 * response) - to the currently-loaded detail. Deliberately the *only* way
 * `quiz` is ever updated after a mutation: it must never be paired with a
 * forced refetch of the whole detail (see `useQuizAuthoringDetail.replaceQuiz`
 * and quiz-detail.tsx's `onDone`), because a mutation response is already
 * strictly fresher than anything a subsequent GET could return, and
 * discarding it to re-fetch is what previously let a transient failure in
 * the (much larger) refetch fan-out mask a successful publish/archive as
 * stale/unpublished state.
 */
export function applyQuizLifecycleResult(detail: QuizAuthoringDetail, quiz: QuizSummary): QuizAuthoringDetail {
  return { ...detail, quiz };
}

async function getQuizAuthoringDetail(api: ApiClient, tenantId: string, quizId: string): Promise<QuizAuthoringDetail> {
  const [quiz, questionsResponse] = await Promise.all([getQuiz(api, tenantId, quizId), listQuestions(api, tenantId, quizId)]);
  const optionsEntries = await Promise.all(
    questionsResponse.items.map(async (question) => [question.questionId, (await listOptions(api, tenantId, quizId, question.questionId)).items] as const),
  );

  return { quiz, questions: questionsResponse.items, optionsByQuestionId: Object.fromEntries(optionsEntries) };
}

export type QuizzesListLoadState =
  | { status: "loading" }
  | { status: "ready"; data: OffsetPage<QuizSummary> }
  | { status: "error"; error: unknown };

export function useQuizzesList(tenantId: string, offset: number): { state: QuizzesListLoadState; retry: () => void } {
  const [state, setState] = useState<QuizzesListLoadState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const key = `${tenantId}:${offset}:${attempt}`;
  const [trackedKey, setTrackedKey] = useState(key);

  if (trackedKey !== key) {
    setTrackedKey(key);
    setState({ status: "loading" });
  }

  useEffect(() => {
    let cancelled = false;

    listQuizzes(getAuthService().getClient(), tenantId, { limit: QUIZZES_PAGE_SIZE, offset })
      .then((data) => {
        if (!cancelled) {
          setState({ status: "ready", data });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({ status: "error", error });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [tenantId, offset, attempt]);

  return { state, retry: () => setAttempt((value) => value + 1) };
}

export type QuizDetailLoadState =
  | { status: "loading" }
  | { status: "ready"; data: QuizAuthoringDetail }
  | { status: "error"; error: unknown };

export function useQuizAuthoringDetail(tenantId: string, quizId: string): {
  state: QuizDetailLoadState;
  retry: () => void;
  replaceQuiz: (quiz: QuizSummary) => void;
} {
  const [state, setState] = useState<QuizDetailLoadState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const key = `${tenantId}:${quizId}:${attempt}`;
  const [trackedKey, setTrackedKey] = useState(key);

  if (trackedKey !== key) {
    setTrackedKey(key);
    setState({ status: "loading" });
  }

  useEffect(() => {
    let cancelled = false;

    getQuizAuthoringDetail(getAuthService().getClient(), tenantId, quizId)
      .then((data) => {
        if (!cancelled) {
          setState({ status: "ready", data });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({ status: "error", error });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [tenantId, quizId, attempt]);

  return {
    state,
    retry: () => setAttempt((value) => value + 1),
    replaceQuiz: (quiz) => {
      setState((current) => (current.status === "ready" ? { status: "ready", data: applyQuizLifecycleResult(current.data, quiz) } : current));
    },
  };
}
