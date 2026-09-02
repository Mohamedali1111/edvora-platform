import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "../../lib/api/client";
import { isNetworkError, resolveErrorMessageKey } from "./error-mapping";

test("maps every known activation backend error code to its message key", () => {
  const cases: Array<[string, string]> = [
    ["ACTIVATION_TOKEN_INVALID", "auth.activate.error.tokenInvalid"],
    ["PASSWORD_POLICY_REJECTED", "auth.activate.error.passwordPolicyRejected"],
  ];

  for (const [code, expectedKey] of cases) {
    const error = new ApiError({ kind: "backend", code, message: "backend detail message", status: 400 });
    assert.equal(resolveErrorMessageKey(error, "auth.activate.error.generic"), expectedKey);
  }
});

test("falls back to the caller-supplied generic key for an unknown backend code", () => {
  const error = new ApiError({ kind: "backend", code: "SOMETHING_UNEXPECTED", message: "detail", status: 500 });
  assert.equal(resolveErrorMessageKey(error, "auth.activate.error.generic"), "auth.activate.error.generic");
});

test("never distinguishes expired/consumed from invalid - the backend itself does not either", () => {
  // The wire contract only ever sends ACTIVATION_TOKEN_INVALID for all three underlying auth
  // errors (see apps/api/.../auth/http/auth-error-mapping.ts's TOKEN_ERROR_CODES handling) - this
  // client must not invent EXPIRED/CONSUMED-specific keys the backend never actually returns.
  const error = new ApiError({ kind: "backend", code: "ACTIVATION_TOKEN_INVALID", message: "Token is invalid.", status: 400 });
  assert.equal(resolveErrorMessageKey(error, "auth.activate.error.generic"), "auth.activate.error.tokenInvalid");
});

test("falls back for a non-ApiError value", () => {
  assert.equal(resolveErrorMessageKey(new Error("boom"), "auth.activate.error.generic"), "auth.activate.error.generic");
  assert.equal(resolveErrorMessageKey(null, "auth.activate.error.generic"), "auth.activate.error.generic");
});

test("isNetworkError recognizes only network-kind ApiErrors", () => {
  assert.equal(isNetworkError(new ApiError({ kind: "network", code: "NETWORK_UNAVAILABLE", message: "offline" })), true);
  assert.equal(
    isNetworkError(new ApiError({ kind: "backend", code: "ACTIVATION_TOKEN_INVALID", message: "x", status: 400 })),
    false,
  );
  assert.equal(isNetworkError(new Error("boom")), false);
});
