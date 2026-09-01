import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "../../../lib/api/client";
import { isNetworkError, resolveErrorMessageKey } from "./error-mapping";

function backendError(code: string): ApiError {
  return new ApiError({ kind: "backend", code, message: "raw backend message", status: 404 });
}

test("maps the frozen NOTIFICATION_NOT_FOUND code to its translated key", () => {
  assert.equal(resolveErrorMessageKey(backendError("NOTIFICATION_NOT_FOUND"), "notifications.errorLoad"), "notifications.errorNotFound");
});

test("falls back to the caller-supplied generic key for a code this feature doesn't specifically handle (e.g. the INSTRUCTOR_REQUIRED role gate) - never the raw backend message", () => {
  assert.equal(resolveErrorMessageKey(backendError("INSTRUCTOR_REQUIRED"), "notifications.errorLoad"), "notifications.errorLoad");
});

test("falls back to the generic key for a non-ApiError", () => {
  assert.equal(resolveErrorMessageKey(new Error("boom"), "notifications.markReadErrorGeneric"), "notifications.markReadErrorGeneric");
});

test("isNetworkError distinguishes a network failure from a backend error response", () => {
  assert.equal(isNetworkError(new ApiError({ kind: "network", code: "NETWORK_ERROR", message: "offline" })), true);
  assert.equal(isNetworkError(backendError("NOTIFICATION_NOT_FOUND")), false);
});
