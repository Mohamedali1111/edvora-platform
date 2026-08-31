import assert from "node:assert/strict";
import test from "node:test";
import { ApiClient } from "../../../lib/api/client";
import { archiveCourse, createCourse, getCourse, listCourses, publishCourse, updateCourse } from "./courses-service";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const COURSE_ID = "33333333-3333-4333-8333-333333333333";

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

test("requests the courses list scoped to the authenticated tenant with only the exact bounded limit/offset given", async () => {
  let requestedUrl = "";
  const api = new ApiClient({
    baseUrl: "http://api.test",
    fetchFn: async (input) => {
      requestedUrl = String(input);
      return json({ items: [], limit: 20, offset: 40, hasMore: true });
    },
  });

  await listCourses(api, TENANT_ID, { limit: 20, offset: 40 });

  // No search/filter param exists on the frozen course list endpoint - the request
  // must never invent one (there is nothing to send beyond limit/offset/tenant).
  assert.equal(requestedUrl, `http://api.test/instructor/tenants/${TENANT_ID}/courses?limit=20&offset=40`);
});

test("passes the courses page through verbatim - no total/count field is ever added", async () => {
  const api = new ApiClient({
    baseUrl: "http://api.test",
    fetchFn: async () => json({ items: [{ courseId: "c1" }], limit: 20, offset: 0, hasMore: true }),
  });

  const page = await listCourses(api, TENANT_ID, { limit: 20, offset: 0 });

  assert.deepEqual(Object.keys(page).sort(), ["hasMore", "items", "limit", "offset"]);
  assert.equal(page.hasMore, true);
});

test("fetches a single course by id from the tenant-scoped detail endpoint", async () => {
  let requestedUrl = "";
  const api = new ApiClient({
    baseUrl: "http://api.test",
    fetchFn: async (input) => {
      requestedUrl = String(input);
      return json({ courseId: COURSE_ID, title: "Algebra I" });
    },
  });

  await getCourse(api, TENANT_ID, COURSE_ID);

  assert.equal(requestedUrl, `http://api.test/instructor/tenants/${TENANT_ID}/courses/${COURSE_ID}`);
});

test("creates a course with a trimmed title and only the fields the create dialog collects", async () => {
  let method = "";
  let requestBody: unknown;
  const api = new ApiClient({
    baseUrl: "http://api.test",
    fetchFn: async (input, init) => {
      method = init?.method ?? "";
      requestBody = init?.body ? JSON.parse(String(init.body)) : undefined;
      return json({ courseId: COURSE_ID, status: "DRAFT" });
    },
  });

  await createCourse(api, TENANT_ID, { title: "Algebra I", description: "Foundations", visibility: "ENROLLED_ONLY" });

  assert.equal(method, "POST");
  assert.deepEqual(requestBody, { title: "Algebra I", description: "Foundations", visibility: "ENROLLED_ONLY" });
});

test("updates a course via PATCH with only the edited metadata fields", async () => {
  let method = "";
  let requestUrl = "";
  let requestBody: unknown;
  const api = new ApiClient({
    baseUrl: "http://api.test",
    fetchFn: async (input, init) => {
      method = init?.method ?? "";
      requestUrl = String(input);
      requestBody = init?.body ? JSON.parse(String(init.body)) : undefined;
      return json({ courseId: COURSE_ID, title: "Algebra I: Revised" });
    },
  });

  await updateCourse(api, TENANT_ID, COURSE_ID, { title: "Algebra I: Revised", description: null, visibility: "PRIVATE" });

  assert.equal(method, "PATCH");
  assert.equal(requestUrl, `http://api.test/instructor/tenants/${TENANT_ID}/courses/${COURSE_ID}`);
  assert.deepEqual(requestBody, { title: "Algebra I: Revised", description: null, visibility: "PRIVATE" });
});

test("publishes a course via POST to the exact publish endpoint with no body", async () => {
  let requestUrl = "";
  let method = "";
  let hasBody = false;
  const api = new ApiClient({
    baseUrl: "http://api.test",
    fetchFn: async (input, init) => {
      requestUrl = String(input);
      method = init?.method ?? "";
      hasBody = init?.body !== undefined;
      return json({ courseId: COURSE_ID, status: "PUBLISHED" });
    },
  });

  await publishCourse(api, TENANT_ID, COURSE_ID);

  assert.equal(requestUrl, `http://api.test/instructor/tenants/${TENANT_ID}/courses/${COURSE_ID}/publish`);
  assert.equal(method, "POST");
  assert.equal(hasBody, false);
});

test("archives a course via POST to the exact archive endpoint with no body", async () => {
  let requestUrl = "";
  let method = "";
  let hasBody = false;
  const api = new ApiClient({
    baseUrl: "http://api.test",
    fetchFn: async (input, init) => {
      requestUrl = String(input);
      method = init?.method ?? "";
      hasBody = init?.body !== undefined;
      return json({ courseId: COURSE_ID, status: "ARCHIVED" });
    },
  });

  await archiveCourse(api, TENANT_ID, COURSE_ID);

  assert.equal(requestUrl, `http://api.test/instructor/tenants/${TENANT_ID}/courses/${COURSE_ID}/archive`);
  assert.equal(method, "POST");
  assert.equal(hasBody, false);
});
