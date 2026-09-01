import assert from "node:assert/strict";
import test from "node:test";
import { ApiClient } from "../../../lib/api/client";
import { listCourseProgress, listQuizAttempts } from "./progress-service";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const COURSE_ID = "22222222-2222-4222-8222-222222222222";
const QUIZ_ID = "33333333-3333-4333-8333-333333333333";
const STUDENT_ID = "44444444-4444-4444-8444-444444444444";

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

test("requests the course progress report with only the bounded limit/offset when no status filter is set", async () => {
  let requestedUrl = "";
  const api = new ApiClient({
    baseUrl: "http://api.test",
    fetchFn: async (input) => {
      requestedUrl = String(input);
      return json({ items: [], limit: 20, offset: 0, hasMore: false });
    },
  });

  await listCourseProgress(api, TENANT_ID, COURSE_ID, { limit: 20, offset: 0 });

  assert.equal(requestedUrl, `http://api.test/instructor/tenants/${TENANT_ID}/courses/${COURSE_ID}/progress?limit=20&offset=0`);
});

test("includes the status query param only when a real EnrollmentStatus filter is given", async () => {
  let requestedUrl = "";
  const api = new ApiClient({
    baseUrl: "http://api.test",
    fetchFn: async (input) => {
      requestedUrl = String(input);
      return json({ items: [], limit: 20, offset: 40, hasMore: true });
    },
  });

  await listCourseProgress(api, TENANT_ID, COURSE_ID, { status: "ACTIVE", limit: 20, offset: 40 });

  assert.equal(requestedUrl, `http://api.test/instructor/tenants/${TENANT_ID}/courses/${COURSE_ID}/progress?limit=20&offset=40&status=ACTIVE`);
});

test("passes the course progress page through verbatim - no total/count field is ever added", async () => {
  const api = new ApiClient({
    baseUrl: "http://api.test",
    fetchFn: async () => json({ items: [{ enrollmentId: "e1", progressPercent: 50 }], limit: 20, offset: 0, hasMore: true }),
  });

  const page = await listCourseProgress(api, TENANT_ID, COURSE_ID, { limit: 20, offset: 0 });

  assert.deepEqual(Object.keys(page).sort(), ["hasMore", "items", "limit", "offset"]);
  assert.equal(page.items[0]?.progressPercent, 50);
});

test("requests the quiz results report with only the bounded limit/offset when no filters are set", async () => {
  let requestedUrl = "";
  const api = new ApiClient({
    baseUrl: "http://api.test",
    fetchFn: async (input) => {
      requestedUrl = String(input);
      return json({ items: [], limit: 20, offset: 0, hasMore: false });
    },
  });

  await listQuizAttempts(api, TENANT_ID, QUIZ_ID, { limit: 20, offset: 0 });

  assert.equal(requestedUrl, `http://api.test/instructor/tenants/${TENANT_ID}/quizzes/${QUIZ_ID}/attempts?limit=20&offset=0`);
});

test("includes studentUserId only when given, scoped to this one quiz's attempts", async () => {
  let requestedUrl = "";
  const api = new ApiClient({
    baseUrl: "http://api.test",
    fetchFn: async (input) => {
      requestedUrl = String(input);
      return json({ items: [], limit: 20, offset: 0, hasMore: false });
    },
  });

  await listQuizAttempts(api, TENANT_ID, QUIZ_ID, { studentUserId: STUDENT_ID, limit: 20, offset: 0 });

  assert.equal(requestedUrl, `http://api.test/instructor/tenants/${TENANT_ID}/quizzes/${QUIZ_ID}/attempts?limit=20&offset=0&studentUserId=${STUDENT_ID}`);
});

test("includes passed=true/false explicitly - and omits it entirely rather than sending an empty/ALL value", async () => {
  const urls: string[] = [];
  const api = new ApiClient({
    baseUrl: "http://api.test",
    fetchFn: async (input) => {
      urls.push(String(input));
      return json({ items: [], limit: 20, offset: 0, hasMore: false });
    },
  });

  await listQuizAttempts(api, TENANT_ID, QUIZ_ID, { passed: true, limit: 20, offset: 0 });
  await listQuizAttempts(api, TENANT_ID, QUIZ_ID, { passed: false, limit: 20, offset: 0 });
  await listQuizAttempts(api, TENANT_ID, QUIZ_ID, { limit: 20, offset: 0 });

  assert.equal(urls[0], `http://api.test/instructor/tenants/${TENANT_ID}/quizzes/${QUIZ_ID}/attempts?limit=20&offset=0&passed=true`);
  assert.equal(urls[1], `http://api.test/instructor/tenants/${TENANT_ID}/quizzes/${QUIZ_ID}/attempts?limit=20&offset=0&passed=false`);
  assert.equal(urls[2], `http://api.test/instructor/tenants/${TENANT_ID}/quizzes/${QUIZ_ID}/attempts?limit=20&offset=0`);
});

test("passes the quiz attempts page through verbatim, including the backend's historical passed/percentage snapshot fields unchanged", async () => {
  const api = new ApiClient({
    baseUrl: "http://api.test",
    fetchFn: async () =>
      json({
        items: [{ attemptId: "a1", passed: true, percentage: "83.30", scorePoints: "8.50", maxPoints: "10.00" }],
        limit: 20,
        offset: 0,
        hasMore: false,
      }),
  });

  const page = await listQuizAttempts(api, TENANT_ID, QUIZ_ID, { limit: 20, offset: 0 });

  assert.deepEqual(page.items[0], { attemptId: "a1", passed: true, percentage: "83.30", scorePoints: "8.50", maxPoints: "10.00" });
});
