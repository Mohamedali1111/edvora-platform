import assert from "node:assert/strict";
import test from "node:test";
import { ApiClient } from "../../../lib/api/client";
import { addStudent, getStudent, listStudents } from "./students-service";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

test("requests the students list with the exact bounded limit/offset given, never an unbounded fetch", async () => {
  let requestedUrl = "";
  const api = new ApiClient({
    baseUrl: "http://api.test",
    fetchFn: async (input) => {
      requestedUrl = String(input);
      return json({ items: [], limit: 20, offset: 40, hasMore: true });
    },
  });

  await listStudents(api, TENANT_ID, { limit: 20, offset: 40 });

  assert.equal(requestedUrl, `http://api.test/instructor/tenants/${TENANT_ID}/students?limit=20&offset=40`);
});

test("passes through the backend page verbatim - no total/count field is ever added", async () => {
  const api = new ApiClient({
    baseUrl: "http://api.test",
    fetchFn: async () => json({ items: [{ associationId: "a1" }], limit: 20, offset: 0, hasMore: true }),
  });

  const page = await listStudents(api, TENANT_ID, { limit: 20, offset: 0 });

  assert.deepEqual(Object.keys(page).sort(), ["hasMore", "items", "limit", "offset"]);
  assert.equal(page.hasMore, true);
});

test("fetches a single student by id from the tenant-scoped detail endpoint", async () => {
  let requestedUrl = "";
  const studentId = "22222222-2222-4222-8222-222222222222";
  const api = new ApiClient({
    baseUrl: "http://api.test",
    fetchFn: async (input) => {
      requestedUrl = String(input);
      return json({ associationId: "a1", userId: studentId, email: "s@example.test" });
    },
  });

  await getStudent(api, TENANT_ID, studentId);

  assert.equal(requestedUrl, `http://api.test/instructor/tenants/${TENANT_ID}/students/${studentId}`);
});

test("posts a trimmed add-student request with only email and displayName", async () => {
  let requestBody: unknown;
  let method = "";
  const api = new ApiClient({
    baseUrl: "http://api.test",
    fetchFn: async (input, init) => {
      method = init?.method ?? "";
      requestBody = init?.body ? JSON.parse(String(init.body)) : undefined;
      return json({ associationId: "a1", activation: null });
    },
  });

  await addStudent(api, TENANT_ID, { email: "new@example.test", displayName: "New Student" });

  assert.equal(method, "POST");
  assert.deepEqual(requestBody, { email: "new@example.test", displayName: "New Student" });
});

test("new-account response: the service passes the full one-time activation payload through untouched", async () => {
  const api = new ApiClient({
    baseUrl: "http://api.test",
    fetchFn: async () =>
      json({
        associationId: "a1",
        userId: "u1",
        email: "new@example.test",
        activation: { id: "t1", rawToken: "secret-one-time-token", expiresAt: "2026-09-08T00:00:00.000Z", purpose: "STUDENT_ACTIVATION" },
      }),
  });

  const result = await addStudent(api, TENANT_ID, { email: "new@example.test" });

  // The service must not strip, rename, or otherwise discard any field the one-time
  // handoff UI needs (see AddStudentDialog) - it's the UI's job to never render/log
  // it beyond that one dismissible screen, not the service's job to withhold it.
  assert.deepEqual(result.activation, {
    id: "t1",
    rawToken: "secret-one-time-token",
    expiresAt: "2026-09-08T00:00:00.000Z",
    purpose: "STUDENT_ACTIVATION",
  });
});

test("existing/reactivated student response: activation is exactly null, never fabricated", async () => {
  const api = new ApiClient({
    baseUrl: "http://api.test",
    fetchFn: async () => json({ associationId: "a2", userId: "u2", email: "existing@example.test", activation: null }),
  });

  const result = await addStudent(api, TENANT_ID, { email: "existing@example.test" });

  assert.equal(result.activation, null);
});

test("success-state differentiation: the two backend outcomes are structurally distinguishable by activation alone", async () => {
  // This is the exact condition AddStudentDialog and StudentsList branch on
  // (`result.activation ? ... : ...`) to decide whether to show the one-time
  // activation handoff or a plain "student added" confirmation - never both,
  // never guessed from anything else in the response.
  const newAccountApi = new ApiClient({
    baseUrl: "http://api.test",
    fetchFn: async () => json({ associationId: "a1", activation: { id: "t1", rawToken: "x", expiresAt: "2026-09-08T00:00:00.000Z", purpose: "STUDENT_ACTIVATION" } }),
  });
  const existingApi = new ApiClient({
    baseUrl: "http://api.test",
    fetchFn: async () => json({ associationId: "a2", activation: null }),
  });

  const newAccountResult = await addStudent(newAccountApi, TENANT_ID, { email: "new@example.test" });
  const existingResult = await addStudent(existingApi, TENANT_ID, { email: "existing@example.test" });

  assert.equal(Boolean(newAccountResult.activation), true);
  assert.equal(Boolean(existingResult.activation), false);
});

test("the students service layer never touches sessionStorage/localStorage - the activation secret cannot be persisted by it", async () => {
  const storageCalls: string[] = [];
  const watchedStorage = (label: string): Storage =>
    ({
      getItem: () => {
        storageCalls.push(`${label}.getItem`);
        return null;
      },
      setItem: () => {
        storageCalls.push(`${label}.setItem`);
      },
      removeItem: () => storageCalls.push(`${label}.removeItem`),
      clear: () => storageCalls.push(`${label}.clear`),
      key: () => null,
      length: 0,
    }) as Storage;

  const globalWithWindow = globalThis as Record<string, unknown>;
  const hadWindow = "window" in globalWithWindow;
  const previousWindow = globalWithWindow.window;
  globalWithWindow.window = {
    sessionStorage: watchedStorage("sessionStorage"),
    localStorage: watchedStorage("localStorage"),
  };

  try {
    const api = new ApiClient({
      baseUrl: "http://api.test",
      fetchFn: async () =>
        json({ associationId: "a1", activation: { id: "t1", rawToken: "secret-one-time-token", expiresAt: "2026-09-08T00:00:00.000Z", purpose: "STUDENT_ACTIVATION" } }),
    });

    await addStudent(api, TENANT_ID, { email: "new@example.test" });

    assert.deepEqual(storageCalls, []);
  } finally {
    if (hadWindow) {
      globalWithWindow.window = previousWindow;
    } else {
      delete globalWithWindow.window;
    }
  }
});
