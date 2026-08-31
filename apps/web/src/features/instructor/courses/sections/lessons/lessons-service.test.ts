import assert from "node:assert/strict";
import test from "node:test";
import { ApiClient } from "../../../../../lib/api/client";
import {
  archiveLesson,
  createLesson,
  listDocumentAssetsForSelection,
  listLessons,
  listQuizzesForSelection,
  listVideoAssetsForSelection,
  publishLesson,
  reorderLessons,
  updateLesson,
} from "./lessons-service";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const COURSE_ID = "22222222-2222-4222-8222-222222222222";
const SECTION_ID = "33333333-3333-4333-8333-333333333333";
const LESSON_ID = "44444444-4444-4444-8444-444444444444";

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

test("requests the lesson list scoped to tenant/course/section, unpaginated", async () => {
  let requestedUrl = "";
  const api = new ApiClient({
    baseUrl: "http://api.test",
    fetchFn: async (input) => {
      requestedUrl = String(input);
      return json({ items: [] });
    },
  });

  await listLessons(api, TENANT_ID, COURSE_ID, SECTION_ID);

  assert.equal(
    requestedUrl,
    `http://api.test/instructor/tenants/${TENANT_ID}/courses/${COURSE_ID}/sections/${SECTION_ID}/lessons`,
  );
});

test("passes the lesson list response through verbatim - only items, no total/count field is ever added", async () => {
  const api = new ApiClient({
    baseUrl: "http://api.test",
    fetchFn: async () => json({ items: [{ lessonId: "l1" }, { lessonId: "l2" }] }),
  });

  const response = await listLessons(api, TENANT_ID, COURSE_ID, SECTION_ID);

  assert.deepEqual(Object.keys(response), ["items"]);
  assert.equal(response.items.length, 2);
});

test("creates a lesson with exactly the given fields - no client-supplied position, no invented asset/quiz reference", async () => {
  let method = "";
  let requestBody: unknown;
  const api = new ApiClient({
    baseUrl: "http://api.test",
    fetchFn: async (input, init) => {
      method = init?.method ?? "";
      requestBody = init?.body ? JSON.parse(String(init.body)) : undefined;
      return json({ lessonId: LESSON_ID, status: "DRAFT", position: 1 });
    },
  });

  await createLesson(api, TENANT_ID, COURSE_ID, SECTION_ID, {
    title: "Intro video",
    type: "VIDEO",
    videoAssetId: "asset-1",
  });

  assert.equal(method, "POST");
  assert.deepEqual(requestBody, { title: "Intro video", type: "VIDEO", videoAssetId: "asset-1" });
  assert.equal(Object.prototype.hasOwnProperty.call(requestBody, "position"), false);
});

test("updates a lesson via PATCH with only the edited metadata/availability fields", async () => {
  let method = "";
  let requestUrl = "";
  let requestBody: unknown;
  const api = new ApiClient({
    baseUrl: "http://api.test",
    fetchFn: async (input, init) => {
      method = init?.method ?? "";
      requestUrl = String(input);
      requestBody = init?.body ? JSON.parse(String(init.body)) : undefined;
      return json({ lessonId: LESSON_ID, title: "Updated" });
    },
  });

  await updateLesson(api, TENANT_ID, COURSE_ID, SECTION_ID, LESSON_ID, {
    title: "Updated",
    description: null,
    availableFrom: "2026-09-01",
  });

  assert.equal(method, "PATCH");
  assert.equal(
    requestUrl,
    `http://api.test/instructor/tenants/${TENANT_ID}/courses/${COURSE_ID}/sections/${SECTION_ID}/lessons/${LESSON_ID}`,
  );
  assert.deepEqual(requestBody, { title: "Updated", description: null, availableFrom: "2026-09-01" });
});

test("publishes a lesson via POST to the exact publish endpoint with no body", async () => {
  let requestUrl = "";
  let method = "";
  let hasBody = false;
  const api = new ApiClient({
    baseUrl: "http://api.test",
    fetchFn: async (input, init) => {
      requestUrl = String(input);
      method = init?.method ?? "";
      hasBody = init?.body !== undefined;
      return json({ lessonId: LESSON_ID, status: "PUBLISHED" });
    },
  });

  await publishLesson(api, TENANT_ID, COURSE_ID, SECTION_ID, LESSON_ID);

  assert.equal(
    requestUrl,
    `http://api.test/instructor/tenants/${TENANT_ID}/courses/${COURSE_ID}/sections/${SECTION_ID}/lessons/${LESSON_ID}/publish`,
  );
  assert.equal(method, "POST");
  assert.equal(hasBody, false);
});

test("archives a lesson via POST to the exact archive endpoint with no body", async () => {
  let requestUrl = "";
  let method = "";
  let hasBody = false;
  const api = new ApiClient({
    baseUrl: "http://api.test",
    fetchFn: async (input, init) => {
      requestUrl = String(input);
      method = init?.method ?? "";
      hasBody = init?.body !== undefined;
      return json({ lessonId: LESSON_ID, status: "ARCHIVED" });
    },
  });

  await archiveLesson(api, TENANT_ID, COURSE_ID, SECTION_ID, LESSON_ID);

  assert.equal(
    requestUrl,
    `http://api.test/instructor/tenants/${TENANT_ID}/courses/${COURSE_ID}/sections/${SECTION_ID}/lessons/${LESSON_ID}/archive`,
  );
  assert.equal(method, "POST");
  assert.equal(hasBody, false);
});

test("reorders lessons via POST to the section-scoped reorder endpoint with exactly { lessonIds }", async () => {
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

  await reorderLessons(api, TENANT_ID, COURSE_ID, SECTION_ID, ["l2", "l1", "l3"]);

  assert.equal(
    requestUrl,
    `http://api.test/instructor/tenants/${TENANT_ID}/courses/${COURSE_ID}/sections/${SECTION_ID}/lessons/reorder`,
  );
  assert.equal(method, "POST");
  assert.deepEqual(requestBody, { lessonIds: ["l2", "l1", "l3"] });
});

test("content-selection lists request only a bounded page from the real, already-existing tenant asset/quiz endpoints - never upload/author anything", async () => {
  let videoUrl = "";
  let documentUrl = "";
  let quizUrl = "";
  const api = new ApiClient({
    baseUrl: "http://api.test",
    fetchFn: async (input) => {
      const url = String(input);
      if (url.includes("/media/videos")) {
        videoUrl = url;
        return json({ items: [], limit: 10, offset: 0, hasMore: false });
      }
      if (url.includes("/media/documents")) {
        documentUrl = url;
        return json({ items: [], limit: 10, offset: 0, hasMore: false });
      }
      quizUrl = url;
      return json({ items: [], limit: 10, offset: 0, hasMore: false });
    },
  });

  const videoPage = await listVideoAssetsForSelection(api, TENANT_ID, 0);
  const documentPage = await listDocumentAssetsForSelection(api, TENANT_ID, 10);
  const quizPage = await listQuizzesForSelection(api, TENANT_ID, 0);

  assert.equal(videoUrl, `http://api.test/instructor/tenants/${TENANT_ID}/media/videos?limit=10&offset=0`);
  assert.equal(documentUrl, `http://api.test/instructor/tenants/${TENANT_ID}/media/documents?limit=10&offset=10`);
  assert.equal(quizUrl, `http://api.test/instructor/tenants/${TENANT_ID}/quizzes?limit=10&offset=0`);
  // No total/count field is ever added to any of the three passthrough pages.
  assert.deepEqual(Object.keys(videoPage).sort(), ["hasMore", "items", "limit", "offset"]);
  assert.deepEqual(Object.keys(documentPage).sort(), ["hasMore", "items", "limit", "offset"]);
  assert.deepEqual(Object.keys(quizPage).sort(), ["hasMore", "items", "limit", "offset"]);
});
