import assert from "node:assert/strict";
import test from "node:test";
import { ApiClient } from "../../../lib/api/client";
import { createEnrollment, listCourses, listEnrollmentsForStudent, revokeEnrollment } from "./enrollments-service";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const STUDENT_ID = "22222222-2222-4222-8222-222222222222";
const COURSE_ID = "33333333-3333-4333-8333-333333333333";
const ENROLLMENT_ID = "44444444-4444-4444-8444-444444444444";

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

test("always scopes the enrollment list query to a student (the backend requires courseId or studentUserId)", async () => {
  let requestedUrl = "";
  const api = new ApiClient({
    baseUrl: "http://api.test",
    fetchFn: async (input) => {
      requestedUrl = String(input);
      return json({ items: [], limit: 10, offset: 0, hasMore: false });
    },
  });

  await listEnrollmentsForStudent(api, TENANT_ID, STUDENT_ID, { limit: 10, offset: 0 });

  const url = new URL(requestedUrl);
  assert.equal(url.searchParams.get("studentUserId"), STUDENT_ID);
  assert.equal(url.searchParams.get("limit"), "10");
  assert.equal(url.searchParams.get("offset"), "0");
  assert.equal(url.searchParams.has("status"), false);
});

test("status filtering is a real backend query param, sent only when a filter is actually chosen", async () => {
  let requestedUrl = "";
  const api = new ApiClient({
    baseUrl: "http://api.test",
    fetchFn: async (input) => {
      requestedUrl = String(input);
      return json({ items: [], limit: 10, offset: 0, hasMore: false });
    },
  });

  await listEnrollmentsForStudent(api, TENANT_ID, STUDENT_ID, { limit: 10, offset: 0, status: "ACTIVE" });

  assert.equal(new URL(requestedUrl).searchParams.get("status"), "ACTIVE");
});

test("enrollment list page is passed through verbatim - no total/count field is ever added", async () => {
  const api = new ApiClient({
    baseUrl: "http://api.test",
    fetchFn: async () => json({ items: [{ enrollmentId: "e1" }], limit: 10, offset: 0, hasMore: true }),
  });

  const page = await listEnrollmentsForStudent(api, TENANT_ID, STUDENT_ID, { limit: 10, offset: 0 });

  assert.deepEqual(Object.keys(page).sort(), ["hasMore", "items", "limit", "offset"]);
});

test("creates an enrollment with exactly studentUserId, courseId, and any given optional dates", async () => {
  let requestBody: unknown;
  let method = "";
  const api = new ApiClient({
    baseUrl: "http://api.test",
    fetchFn: async (input, init) => {
      method = init?.method ?? "";
      requestBody = init?.body ? JSON.parse(String(init.body)) : undefined;
      return json({ enrollmentId: ENROLLMENT_ID, status: "ACTIVE" });
    },
  });

  await createEnrollment(api, TENANT_ID, { studentUserId: STUDENT_ID, courseId: COURSE_ID, startsAt: "2026-09-01", endsAt: "2026-12-01" });

  assert.equal(method, "POST");
  assert.deepEqual(requestBody, {
    studentUserId: STUDENT_ID,
    courseId: COURSE_ID,
    startsAt: "2026-09-01",
    endsAt: "2026-12-01",
  });
});

test("creates an enrollment without dates when none were chosen", async () => {
  let requestBody: unknown;
  const api = new ApiClient({
    baseUrl: "http://api.test",
    fetchFn: async (_input, init) => {
      requestBody = init?.body ? JSON.parse(String(init.body)) : undefined;
      return json({ enrollmentId: ENROLLMENT_ID, status: "ACTIVE" });
    },
  });

  await createEnrollment(api, TENANT_ID, { studentUserId: STUDENT_ID, courseId: COURSE_ID });

  assert.deepEqual(requestBody, { studentUserId: STUDENT_ID, courseId: COURSE_ID });
});

test("revokes an enrollment via POST to the exact revoke endpoint with no body", async () => {
  let requestedUrl = "";
  let method = "";
  let hasBody = false;
  const api = new ApiClient({
    baseUrl: "http://api.test",
    fetchFn: async (input, init) => {
      requestedUrl = String(input);
      method = init?.method ?? "";
      hasBody = init?.body !== undefined;
      return json({ enrollmentId: ENROLLMENT_ID, status: "REVOKED" });
    },
  });

  await revokeEnrollment(api, TENANT_ID, ENROLLMENT_ID);

  assert.equal(requestedUrl, `http://api.test/instructor/tenants/${TENANT_ID}/enrollments/${ENROLLMENT_ID}/revoke`);
  assert.equal(method, "POST");
  assert.equal(hasBody, false);
});

test("course selector requests only a bounded page - never fetches or aggregates unboundedly", async () => {
  let requestedUrl = "";
  const api = new ApiClient({
    baseUrl: "http://api.test",
    fetchFn: async (input) => {
      requestedUrl = String(input);
      return json({ items: [], limit: 10, offset: 20, hasMore: true });
    },
  });

  const page = await listCourses(api, TENANT_ID, { limit: 10, offset: 20 });

  assert.match(requestedUrl, /limit=10&offset=20$/);
  assert.deepEqual(Object.keys(page).sort(), ["hasMore", "items", "limit", "offset"]);
});
