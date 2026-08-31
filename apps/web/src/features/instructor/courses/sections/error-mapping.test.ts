import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "../../../../lib/api/client";
import { isNetworkError, isSectionLifecycleConflict, resolveErrorMessageKey } from "./error-mapping";

test("maps every known section backend error code to its message key", () => {
  const cases: Array<[string, string]> = [
    ["COURSE_NOT_FOUND", "courses.detailNotFound"],
    ["SECTION_NOT_FOUND", "sections.notFoundError"],
    ["INVALID_SECTION_LIFECYCLE_TRANSITION", "sections.errorInvalidTransition"],
    ["SECTION_POSITION_CONFLICT", "sections.errorPositionConflict"],
    ["INVALID_SECTION_REORDER", "sections.errorInvalidReorder"],
    ["VALIDATION_FAILED", "courses.errorValidation"],
  ];

  for (const [code, expectedKey] of cases) {
    const error = new ApiError({ kind: "backend", code, message: "backend detail message", status: 409 });
    assert.equal(resolveErrorMessageKey(error, "sections.createErrorGeneric"), expectedKey);
  }
});

test("falls back to the caller's fallback key for an unmapped backend error code", () => {
  const error = new ApiError({ kind: "backend", code: "SOME_UNMAPPED_CODE", message: "detail", status: 500 });
  assert.equal(resolveErrorMessageKey(error, "sections.createErrorGeneric"), "sections.createErrorGeneric");
});

test("falls back to the caller's fallback key for a non-ApiError value", () => {
  assert.equal(resolveErrorMessageKey(new Error("boom"), "sections.editErrorGeneric"), "sections.editErrorGeneric");
});

test("identifies a section lifecycle-conflict response, driving the stale-page refetch", () => {
  const conflict = new ApiError({ kind: "backend", code: "INVALID_SECTION_LIFECYCLE_TRANSITION", message: "detail", status: 409 });
  assert.equal(isSectionLifecycleConflict(conflict), true);
});

test("does not treat other backend codes, network errors, or non-ApiError values as a section lifecycle conflict", () => {
  const notFound = new ApiError({ kind: "backend", code: "SECTION_NOT_FOUND", message: "detail", status: 404 });
  const networkError = new ApiError({ kind: "network", code: "NETWORK_UNAVAILABLE", message: "offline" });

  assert.equal(isSectionLifecycleConflict(notFound), false);
  assert.equal(isSectionLifecycleConflict(networkError), false);
  assert.equal(isSectionLifecycleConflict(new Error("boom")), false);
  assert.equal(isSectionLifecycleConflict(null), false);
});

test("re-exports the shared network-error check rather than redefining it", () => {
  const networkError = new ApiError({ kind: "network", code: "NETWORK_UNAVAILABLE", message: "offline" });
  const backendError = new ApiError({ kind: "backend", code: "SECTION_NOT_FOUND", message: "detail", status: 404 });

  assert.equal(isNetworkError(networkError), true);
  assert.equal(isNetworkError(backendError), false);
});
