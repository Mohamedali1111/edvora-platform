import assert from "node:assert/strict";
import test from "node:test";
import { ApiClient } from "../../../lib/api/client";
import { listNotifications, markNotificationRead } from "./notifications-service";

const NOTIFICATION_ID = "11111111-1111-4111-8111-111111111111";

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

test("requests the notification list with exactly the bounded limit/offset - no tenantId in the URL", async () => {
  let requestedUrl = "";
  const api = new ApiClient({
    baseUrl: "http://api.test",
    fetchFn: async (input) => {
      requestedUrl = String(input);
      return json({ items: [], limit: 20, offset: 40, hasMore: true });
    },
  });

  await listNotifications(api, { limit: 20, offset: 40 });

  assert.equal(requestedUrl, "http://api.test/instructor/notifications?limit=20&offset=40");
});

test("passes the notification page through verbatim - no total/count field is ever added, and the backend's read/readAt/category fields survive unchanged", async () => {
  const api = new ApiClient({
    baseUrl: "http://api.test",
    fetchFn: async () =>
      json({
        items: [{ notificationId: "n1", read: false, readAt: null, category: "COURSE", type: "COURSE_ENROLLMENT_CREATED" }],
        limit: 20,
        offset: 0,
        hasMore: false,
      }),
  });

  const page = await listNotifications(api, { limit: 20, offset: 0 });

  assert.deepEqual(Object.keys(page).sort(), ["hasMore", "items", "limit", "offset"]);
  assert.deepEqual(page.items[0], { notificationId: "n1", read: false, readAt: null, category: "COURSE", type: "COURSE_ENROLLMENT_CREATED" });
});

test("marks a notification read via PATCH with no request body - readAt is never client-supplied", async () => {
  let requestedUrl = "";
  let method = "";
  let requestBody: unknown;
  const api = new ApiClient({
    baseUrl: "http://api.test",
    fetchFn: async (input, init) => {
      requestedUrl = String(input);
      method = init?.method ?? "";
      requestBody = init?.body;
      return json({ notificationId: NOTIFICATION_ID, read: true, readAt: "2026-09-01T12:00:00.000Z" });
    },
  });

  const result = await markNotificationRead(api, NOTIFICATION_ID);

  assert.equal(requestedUrl, `http://api.test/instructor/notifications/${NOTIFICATION_ID}/read`);
  assert.equal(method, "PATCH");
  assert.equal(requestBody, undefined);
  assert.equal(result.readAt, "2026-09-01T12:00:00.000Z");
});

test("mark-read returns the backend's own response verbatim - the service never fabricates or overrides a field on it", async () => {
  const api = new ApiClient({
    baseUrl: "http://api.test",
    fetchFn: async () =>
      json({
        notificationId: NOTIFICATION_ID,
        type: "COURSE_ENROLLMENT_CREATED",
        category: "COURSE",
        title: "New course enrollment",
        body: "You have been enrolled in Algebra I.",
        domainEntityType: "Enrollment",
        domainEntityId: "e1",
        read: true,
        readAt: "2026-09-01T12:00:00.000Z",
        createdAt: "2026-08-31T09:00:00.000Z",
      }),
  });

  const result = await markNotificationRead(api, NOTIFICATION_ID);

  assert.deepEqual(result, {
    notificationId: NOTIFICATION_ID,
    type: "COURSE_ENROLLMENT_CREATED",
    category: "COURSE",
    title: "New course enrollment",
    body: "You have been enrolled in Algebra I.",
    domainEntityType: "Enrollment",
    domainEntityId: "e1",
    read: true,
    readAt: "2026-09-01T12:00:00.000Z",
    createdAt: "2026-08-31T09:00:00.000Z",
  });
});
