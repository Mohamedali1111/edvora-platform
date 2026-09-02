import assert from "node:assert/strict";
import test from "node:test";
import { ApiClient } from "../../../lib/api/client";
import { reissueInstructorActivation } from "./instructors-service";

const INSTRUCTOR_ID = "22222222-2222-4222-8222-222222222222";

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 201,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

test("reissues activation by calling the exact new backend contract - POST, no body, the instructor-scoped path", async () => {
  let requestedUrl = "";
  let requestedMethod = "";
  let requestedBody: string | undefined;

  const api = new ApiClient({
    baseUrl: "http://api.test",
    fetchFn: async (input, init) => {
      requestedUrl = String(input);
      requestedMethod = String(init?.method);
      requestedBody = init?.body === undefined ? undefined : String(init.body);
      return json({
        id: "activation-id",
        rawToken: "the-new-raw-token",
        expiresAt: "2026-09-10T00:00:00.000Z",
        purpose: "INSTRUCTOR_ACTIVATION",
      });
    },
  });

  const result = await reissueInstructorActivation(api, INSTRUCTOR_ID);

  assert.equal(requestedUrl, `http://api.test/admin/instructors/${INSTRUCTOR_ID}/activation`);
  assert.equal(requestedMethod, "POST");
  assert.equal(requestedBody, undefined);
  assert.equal(result.rawToken, "the-new-raw-token");
  assert.equal(result.purpose, "INSTRUCTOR_ACTIVATION");
});

test("passes the reissued activation result through verbatim, without inventing or dropping fields", async () => {
  const api = new ApiClient({
    baseUrl: "http://api.test",
    fetchFn: async () =>
      json({ id: "a1", rawToken: "raw", expiresAt: "2026-09-10T00:00:00.000Z", purpose: "INSTRUCTOR_ACTIVATION" }),
  });

  const result = await reissueInstructorActivation(api, INSTRUCTOR_ID);

  assert.deepEqual(Object.keys(result).sort(), ["expiresAt", "id", "purpose", "rawToken"]);
});
