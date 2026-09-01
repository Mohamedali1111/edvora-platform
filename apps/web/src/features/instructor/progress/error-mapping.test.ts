import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "../../../lib/api/client";
import { isNetworkError, resolveErrorMessageKey } from "./error-mapping";

function backendError(code: string): ApiError {
  return new ApiError({ kind: "backend", code, message: "raw backend message", status: 404 });
}

test("maps the frozen reporting endpoints' real error codes to their translated keys", () => {
  assert.equal(resolveErrorMessageKey(backendError("COURSE_NOT_FOUND"), "progress.errorLoad"), "progress.errorCourseNotFound");
  assert.equal(resolveErrorMessageKey(backendError("QUIZ_NOT_FOUND"), "progress.errorLoadResults"), "progress.errorQuizNotFound");
  assert.equal(resolveErrorMessageKey(backendError("VALIDATION_FAILED"), "progress.errorLoad"), "progress.errorValidation");
});

test("falls back to the caller-supplied generic key for any code this feature doesn't specifically handle - never the raw backend message", () => {
  assert.equal(resolveErrorMessageKey(backendError("TENANT_ACCESS_DENIED"), "progress.errorLoad"), "progress.errorLoad");
  assert.equal(resolveErrorMessageKey(backendError("RATE_LIMITED"), "progress.errorLoadResults"), "progress.errorLoadResults");
});

test("falls back to the generic key for a non-ApiError or network failure", () => {
  assert.equal(resolveErrorMessageKey(new Error("boom"), "progress.errorLoad"), "progress.errorLoad");
});

test("isNetworkError distinguishes a network failure from a backend error response", () => {
  assert.equal(isNetworkError(new ApiError({ kind: "network", code: "NETWORK_ERROR", message: "offline" })), true);
  assert.equal(isNetworkError(backendError("COURSE_NOT_FOUND")), false);
});
