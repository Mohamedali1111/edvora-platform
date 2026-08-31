import assert from "node:assert/strict";
import test from "node:test";
import { ApiClient } from "../../../lib/api/client";
import {
  archiveQuiz,
  createOption,
  createQuestion,
  createQuiz,
  getQuiz,
  listOptions,
  listQuestions,
  listQuizzes,
  publishQuiz,
  reorderOptions,
  reorderQuestions,
  updateOption,
  updateQuestion,
  updateQuiz,
} from "./quizzes-service";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const QUIZ_ID = "22222222-2222-4222-8222-222222222222";
const QUESTION_ID = "33333333-3333-4333-8333-333333333333";
const OPTION_ID = "44444444-4444-4444-8444-444444444444";

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" }, ...init });
}

test("requests the quiz list with bounded limit/offset and passes the page through without totals", async () => {
  let requestedUrl = "";
  const api = apiWith(async (input) => {
    requestedUrl = String(input);
    return json({ items: [], limit: 20, offset: 40, hasMore: true });
  });

  const page = await listQuizzes(api, TENANT_ID, { limit: 20, offset: 40 });

  assert.equal(requestedUrl, `http://api.test/instructor/tenants/${TENANT_ID}/quizzes?limit=20&offset=40`);
  assert.deepEqual(Object.keys(page).sort(), ["hasMore", "items", "limit", "offset"]);
});

test("fetches quiz detail from the tenant-scoped requested quiz id", async () => {
  let requestedUrl = "";
  const api = apiWith(async (input) => {
    requestedUrl = String(input);
    return json({ quizId: QUIZ_ID });
  });

  await getQuiz(api, TENANT_ID, QUIZ_ID);

  assert.equal(requestedUrl, `http://api.test/instructor/tenants/${TENANT_ID}/quizzes/${QUIZ_ID}`);
});

test("creates, updates, publishes, and archives quizzes via the frozen endpoints", async () => {
  const requests: Array<{ url: string; method: string; body?: unknown }> = [];
  const api = apiWith(async (input, init) => {
    requests.push({ url: String(input), method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return json({ quizId: QUIZ_ID, status: "DRAFT" });
  });

  await createQuiz(api, TENANT_ID, { title: "Quiz", description: null, passingScorePercent: 80, attemptLimit: null, revealAnswersPolicy: "AFTER_SUBMISSION" });
  await updateQuiz(api, TENANT_ID, QUIZ_ID, { title: "Quiz v2", passingScorePercent: null });
  await publishQuiz(api, TENANT_ID, QUIZ_ID);
  await archiveQuiz(api, TENANT_ID, QUIZ_ID);

  assert.deepEqual(requests, [
    {
      url: `http://api.test/instructor/tenants/${TENANT_ID}/quizzes`,
      method: "POST",
      body: { title: "Quiz", description: null, passingScorePercent: 80, attemptLimit: null, revealAnswersPolicy: "AFTER_SUBMISSION" },
    },
    { url: `http://api.test/instructor/tenants/${TENANT_ID}/quizzes/${QUIZ_ID}`, method: "PATCH", body: { title: "Quiz v2", passingScorePercent: null } },
    { url: `http://api.test/instructor/tenants/${TENANT_ID}/quizzes/${QUIZ_ID}/publish`, method: "POST", body: undefined },
    { url: `http://api.test/instructor/tenants/${TENANT_ID}/quizzes/${QUIZ_ID}/archive`, method: "POST", body: undefined },
  ]);
});

test("questions use exact list/create/update/reorder request contracts", async () => {
  const requests: Array<{ url: string; method: string; body?: unknown }> = [];
  const api = apiWith(async (input, init) => {
    requests.push({ url: String(input), method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return json(init?.method === "POST" && String(input).endsWith("/reorder") ? { items: [] } : { items: [], questionId: QUESTION_ID });
  });

  await listQuestions(api, TENANT_ID, QUIZ_ID);
  await createQuestion(api, TENANT_ID, QUIZ_ID, { type: "MULTIPLE_CHOICE", prompt: "Prompt", points: 2 });
  await updateQuestion(api, TENANT_ID, QUIZ_ID, QUESTION_ID, { prompt: "Prompt v2", points: 3 });
  await reorderQuestions(api, TENANT_ID, QUIZ_ID, { questionIds: ["q2", "q1"] });

  assert.deepEqual(requests, [
    { url: `http://api.test/instructor/tenants/${TENANT_ID}/quizzes/${QUIZ_ID}/questions`, method: "GET", body: undefined },
    { url: `http://api.test/instructor/tenants/${TENANT_ID}/quizzes/${QUIZ_ID}/questions`, method: "POST", body: { type: "MULTIPLE_CHOICE", prompt: "Prompt", points: 2 } },
    {
      url: `http://api.test/instructor/tenants/${TENANT_ID}/quizzes/${QUIZ_ID}/questions/${QUESTION_ID}`,
      method: "PATCH",
      body: { prompt: "Prompt v2", points: 3 },
    },
    { url: `http://api.test/instructor/tenants/${TENANT_ID}/quizzes/${QUIZ_ID}/questions/reorder`, method: "POST", body: { questionIds: ["q2", "q1"] } },
  ]);
});

test("options use exact list/create/update/reorder contracts, including one-request isCorrect:true switching", async () => {
  const requests: Array<{ url: string; method: string; body?: unknown }> = [];
  const api = apiWith(async (input, init) => {
    requests.push({ url: String(input), method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return json(init?.method === "POST" && String(input).endsWith("/reorder") ? { items: [] } : { items: [], optionId: OPTION_ID });
  });

  await listOptions(api, TENANT_ID, QUIZ_ID, QUESTION_ID);
  await createOption(api, TENANT_ID, QUIZ_ID, QUESTION_ID, { label: "A", text: "Choice A", isCorrect: false });
  await updateOption(api, TENANT_ID, QUIZ_ID, QUESTION_ID, OPTION_ID, { isCorrect: true });
  await updateOption(api, TENANT_ID, QUIZ_ID, QUESTION_ID, OPTION_ID, { label: null, text: "Choice B" });
  await reorderOptions(api, TENANT_ID, QUIZ_ID, QUESTION_ID, { optionIds: ["o2", "o1"] });

  assert.deepEqual(requests, [
    { url: `http://api.test/instructor/tenants/${TENANT_ID}/quizzes/${QUIZ_ID}/questions/${QUESTION_ID}/options`, method: "GET", body: undefined },
    {
      url: `http://api.test/instructor/tenants/${TENANT_ID}/quizzes/${QUIZ_ID}/questions/${QUESTION_ID}/options`,
      method: "POST",
      body: { label: "A", text: "Choice A", isCorrect: false },
    },
    {
      url: `http://api.test/instructor/tenants/${TENANT_ID}/quizzes/${QUIZ_ID}/questions/${QUESTION_ID}/options/${OPTION_ID}`,
      method: "PATCH",
      body: { isCorrect: true },
    },
    {
      url: `http://api.test/instructor/tenants/${TENANT_ID}/quizzes/${QUIZ_ID}/questions/${QUESTION_ID}/options/${OPTION_ID}`,
      method: "PATCH",
      body: { label: null, text: "Choice B" },
    },
    {
      url: `http://api.test/instructor/tenants/${TENANT_ID}/quizzes/${QUIZ_ID}/questions/${QUESTION_ID}/options/reorder`,
      method: "POST",
      body: { optionIds: ["o2", "o1"] },
    },
  ]);
});

function apiWith(fetchFn: typeof fetch): ApiClient {
  return new ApiClient({ baseUrl: "http://api.test", fetchFn });
}
