import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "../../../lib/api/client";
import { isCourseLifecycleConflict, isNetworkError, resolveErrorMessageKey } from "./error-mapping";

test("maps every known course backend error code to its message key", () => {
  const cases: Array<[string, string]> = [
    ["COURSE_NOT_FOUND", "courses.detailNotFound"],
    ["INVALID_COURSE_LIFECYCLE_TRANSITION", "courses.errorInvalidTransition"],
    ["VALIDATION_FAILED", "courses.errorValidation"],
  ];

  for (const [code, expectedKey] of cases) {
    const error = new ApiError({ kind: "backend", code, message: "backend detail message", status: 409 });
    assert.equal(resolveErrorMessageKey(error, "courses.createErrorGeneric"), expectedKey);
  }
});

test("falls back to the caller's fallback key for an unmapped backend error code", () => {
  const error = new ApiError({ kind: "backend", code: "SOME_UNMAPPED_CODE", message: "detail", status: 500 });
  assert.equal(resolveErrorMessageKey(error, "courses.createErrorGeneric"), "courses.createErrorGeneric");
});

test("falls back to the caller's fallback key for a non-ApiError value", () => {
  assert.equal(resolveErrorMessageKey(new Error("boom"), "courses.saveErrorGeneric"), "courses.saveErrorGeneric");
});

test("re-exports the shared network-error check rather than redefining it", () => {
  const networkError = new ApiError({ kind: "network", code: "NETWORK_UNAVAILABLE", message: "offline" });
  const backendError = new ApiError({ kind: "backend", code: "COURSE_NOT_FOUND", message: "detail", status: 404 });

  assert.equal(isNetworkError(networkError), true);
  assert.equal(isNetworkError(backendError), false);
});

test("identifies a lifecycle-conflict response, driving the stale-page refetch", () => {
  const conflict = new ApiError({ kind: "backend", code: "INVALID_COURSE_LIFECYCLE_TRANSITION", message: "detail", status: 409 });
  assert.equal(isCourseLifecycleConflict(conflict), true);
});

test("does not treat other backend codes, network errors, or non-ApiError values as a lifecycle conflict", () => {
  const notFound = new ApiError({ kind: "backend", code: "COURSE_NOT_FOUND", message: "detail", status: 404 });
  const networkError = new ApiError({ kind: "network", code: "NETWORK_UNAVAILABLE", message: "offline" });

  assert.equal(isCourseLifecycleConflict(notFound), false);
  assert.equal(isCourseLifecycleConflict(networkError), false);
  assert.equal(isCourseLifecycleConflict(new Error("boom")), false);
  assert.equal(isCourseLifecycleConflict(null), false);
});
