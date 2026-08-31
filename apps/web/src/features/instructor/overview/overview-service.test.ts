import assert from "node:assert/strict";
import test from "node:test";
import { ApiClient } from "../../../lib/api/client";
import { fetchInstructorOverview } from "./overview-service";

const TENANT_ID = "tenant-1";

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

test("requests only a small bounded preview page, never the full unbounded list", async () => {
  const requestedUrls: string[] = [];
  const api = new ApiClient({
    baseUrl: "http://api.test",
    fetchFn: async (input) => {
      const url = String(input);
      requestedUrls.push(url);

      if (url.includes("/courses")) {
        return json({ items: [], limit: 5, offset: 0, hasMore: false });
      }
      if (url.includes("/students")) {
        return json({ items: [], limit: 5, offset: 0, hasMore: false });
      }
      return json({ unreadCount: 0 });
    },
  });

  await fetchInstructorOverview(api, TENANT_ID);

  const coursesUrl = requestedUrls.find((url) => url.includes("/courses"));
  const studentsUrl = requestedUrls.find((url) => url.includes("/students"));
  assert.match(coursesUrl ?? "", /limit=5/);
  assert.match(studentsUrl ?? "", /limit=5/);
});

test("never labels a bounded preview page's item count or hasMore as a total", async () => {
  const api = new ApiClient({
    baseUrl: "http://api.test",
    fetchFn: async (input) => {
      const url = String(input);
      if (url.includes("/courses")) {
        // A full page (limit reached) with more rows behind it - the classic
        // case where it would be tempting (and wrong) to call items.length a total.
        return json({
          items: [1, 2, 3, 4, 5].map((n) => ({ courseId: `c${n}`, title: `Course ${n}`, status: "PUBLISHED" })),
          limit: 5,
          offset: 0,
          hasMore: true,
        });
      }
      if (url.includes("/students")) {
        return json({ items: [], limit: 5, offset: 0, hasMore: false });
      }
      return json({ unreadCount: 2 });
    },
  });

  const snapshot = await fetchInstructorOverview(api, TENANT_ID);

  assert.equal(snapshot.courses?.items.length, 5);
  assert.equal(snapshot.courses?.hasMore, true);
  // The service must only ever expose items + hasMore - no invented total/count field.
  assert.deepEqual(Object.keys(snapshot.courses ?? {}).sort(), ["hasMore", "items"]);
});

test("degrades gracefully when exactly one source fails", async () => {
  const api = new ApiClient({
    baseUrl: "http://api.test",
    fetchFn: async (input) => {
      const url = String(input);
      if (url.includes("/courses")) {
        return new Response(JSON.stringify({ error: { code: "INTERNAL", message: "boom" } }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("/students")) {
        return json({ items: [{ associationId: "a1", userId: "u1", email: "s@example.test", displayName: null, status: "ACTIVE" }], limit: 5, offset: 0, hasMore: false });
      }
      return json({ unreadCount: 3 });
    },
  });

  const snapshot = await fetchInstructorOverview(api, TENANT_ID);

  assert.equal(snapshot.courses, null);
  assert.equal(snapshot.students?.items.length, 1);
  assert.equal(snapshot.unreadNotifications, 3);
});

test("degrades gracefully when every source fails, without throwing", async () => {
  const api = new ApiClient({
    baseUrl: "http://api.test",
    fetchFn: async () => {
      throw new Error("offline");
    },
  });

  const snapshot = await fetchInstructorOverview(api, TENANT_ID);

  assert.deepEqual(snapshot, { courses: null, students: null, unreadNotifications: null });
});
