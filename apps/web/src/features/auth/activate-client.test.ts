import assert from "node:assert/strict";
import test from "node:test";
import { ApiClient } from "../../lib/api/client";
import { activateInstructorAccount } from "./activate-client";

function noContent(): Response {
  return new Response(null, { status: 204 });
}

test("submits the exact backend DTO to POST /auth/activate with the INSTRUCTOR_ACTIVATION purpose", async () => {
  let requestedUrl = "";
  let requestedMethod = "";
  let requestedBody: unknown;

  const api = new ApiClient({
    baseUrl: "http://api.test",
    fetchFn: async (input, init) => {
      requestedUrl = String(input);
      requestedMethod = String(init?.method);
      requestedBody = init?.body ? JSON.parse(String(init.body)) : undefined;
      return noContent();
    },
  });

  await activateInstructorAccount(api, { activationToken: "the-raw-token", newPassword: "a-strong-password-123" });

  assert.equal(requestedUrl, "http://api.test/auth/activate");
  assert.equal(requestedMethod, "POST");
  assert.deepEqual(requestedBody, {
    activationToken: "the-raw-token",
    purpose: "INSTRUCTOR_ACTIVATION",
    newPassword: "a-strong-password-123",
  });
});

test("never attaches a Bearer token - activation must work for a caller with no session", async () => {
  let sawAuthorizationHeader = false;

  const api = new ApiClient({
    baseUrl: "http://api.test",
    getAccessToken: () => "should-never-be-sent",
    fetchFn: async (_input, init) => {
      const headers = new Headers(init?.headers);
      sawAuthorizationHeader = headers.has("Authorization");
      return noContent();
    },
  });

  await activateInstructorAccount(api, { activationToken: "token", newPassword: "a-strong-password-123" });

  assert.equal(sawAuthorizationHeader, false);
});

test("resolves to void on the backend's 204 - no session is ever fabricated from this response", async () => {
  const api = new ApiClient({
    baseUrl: "http://api.test",
    fetchFn: async () => noContent(),
  });

  const result = await activateInstructorAccount(api, { activationToken: "token", newPassword: "a-strong-password-123" });

  assert.equal(result, undefined);
});
