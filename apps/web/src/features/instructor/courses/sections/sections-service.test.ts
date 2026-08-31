import assert from "node:assert/strict";
import test from "node:test";
import { ApiClient } from "../../../../lib/api/client";
import { archiveSection, createSection, listSections, publishSection, reorderSections, updateSection } from "./sections-service";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const COURSE_ID = "22222222-2222-4222-8222-222222222222";
const SECTION_ID = "33333333-3333-4333-8333-333333333333";

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

test("requests the section list scoped to the authenticated tenant and course, unpaginated", async () => {
  let requestedUrl = "";
  const api = new ApiClient({
    baseUrl: "http://api.test",
    fetchFn: async (input) => {
      requestedUrl = String(input);
      return json({ items: [] });
    },
  });

  await listSections(api, TENANT_ID, COURSE_ID);

  // The frozen section list endpoint has no limit/offset/pagination params at all -
  // the request must never invent any.
  assert.equal(requestedUrl, `http://api.test/instructor/tenants/${TENANT_ID}/courses/${COURSE_ID}/sections`);
});

test("passes the section list response through verbatim - only items, no total/count field is ever added", async () => {
  const api = new ApiClient({
    baseUrl: "http://api.test",
    fetchFn: async () => json({ items: [{ sectionId: "s1" }, { sectionId: "s2" }] }),
  });

  const response = await listSections(api, TENANT_ID, COURSE_ID);

  assert.deepEqual(Object.keys(response), ["items"]);
  assert.equal(response.items.length, 2);
});

test("creates a section with a trimmed title and only the fields the create dialog collects - no client-supplied position", async () => {
  let method = "";
  let requestBody: unknown;
  const api = new ApiClient({
    baseUrl: "http://api.test",
    fetchFn: async (input, init) => {
      method = init?.method ?? "";
      requestBody = init?.body ? JSON.parse(String(init.body)) : undefined;
      return json({ sectionId: SECTION_ID, status: "DRAFT", position: 1 });
    },
  });

  await createSection(api, TENANT_ID, COURSE_ID, { title: "Getting Started", description: "Intro" });

  assert.equal(method, "POST");
  assert.deepEqual(requestBody, { title: "Getting Started", description: "Intro" });
  assert.equal(Object.prototype.hasOwnProperty.call(requestBody, "position"), false);
});

test("updates a section via PATCH with only the edited metadata fields", async () => {
  let method = "";
  let requestUrl = "";
  let requestBody: unknown;
  const api = new ApiClient({
    baseUrl: "http://api.test",
    fetchFn: async (input, init) => {
      method = init?.method ?? "";
      requestUrl = String(input);
      requestBody = init?.body ? JSON.parse(String(init.body)) : undefined;
      return json({ sectionId: SECTION_ID, title: "Updated" });
    },
  });

  await updateSection(api, TENANT_ID, COURSE_ID, SECTION_ID, { title: "Updated", description: null });

  assert.equal(method, "PATCH");
  assert.equal(requestUrl, `http://api.test/instructor/tenants/${TENANT_ID}/courses/${COURSE_ID}/sections/${SECTION_ID}`);
  assert.deepEqual(requestBody, { title: "Updated", description: null });
});

test("publishes a section via POST to the exact publish endpoint with no body", async () => {
  let requestUrl = "";
  let method = "";
  let hasBody = false;
  const api = new ApiClient({
    baseUrl: "http://api.test",
    fetchFn: async (input, init) => {
      requestUrl = String(input);
      method = init?.method ?? "";
      hasBody = init?.body !== undefined;
      return json({ sectionId: SECTION_ID, status: "PUBLISHED" });
    },
  });

  await publishSection(api, TENANT_ID, COURSE_ID, SECTION_ID);

  assert.equal(requestUrl, `http://api.test/instructor/tenants/${TENANT_ID}/courses/${COURSE_ID}/sections/${SECTION_ID}/publish`);
  assert.equal(method, "POST");
  assert.equal(hasBody, false);
});

test("archives a section via POST to the exact archive endpoint with no body", async () => {
  let requestUrl = "";
  let method = "";
  let hasBody = false;
  const api = new ApiClient({
    baseUrl: "http://api.test",
    fetchFn: async (input, init) => {
      requestUrl = String(input);
      method = init?.method ?? "";
      hasBody = init?.body !== undefined;
      return json({ sectionId: SECTION_ID, status: "ARCHIVED" });
    },
  });

  await archiveSection(api, TENANT_ID, COURSE_ID, SECTION_ID);

  assert.equal(requestUrl, `http://api.test/instructor/tenants/${TENANT_ID}/courses/${COURSE_ID}/sections/${SECTION_ID}/archive`);
  assert.equal(method, "POST");
  assert.equal(hasBody, false);
});

test("reorders sections via POST with exactly { sectionIds } in the given order - the frozen contract, not a single move+target-position", async () => {
  let requestUrl = "";
  let method = "";
  let requestBody: unknown;
  const api = new ApiClient({
    baseUrl: "http://api.test",
    fetchFn: async (input, init) => {
      requestUrl = String(input);
      method = init?.method ?? "";
      requestBody = init?.body ? JSON.parse(String(init.body)) : undefined;
      return json({ items: [] });
    },
  });

  await reorderSections(api, TENANT_ID, COURSE_ID, ["s2", "s1", "s3"]);

  assert.equal(requestUrl, `http://api.test/instructor/tenants/${TENANT_ID}/courses/${COURSE_ID}/sections/reorder`);
  assert.equal(method, "POST");
  assert.deepEqual(requestBody, { sectionIds: ["s2", "s1", "s3"] });
});
