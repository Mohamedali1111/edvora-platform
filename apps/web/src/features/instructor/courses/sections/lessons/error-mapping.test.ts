import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "../../../../../lib/api/client";
import { isLessonLifecycleConflict, isNetworkError, resolveErrorMessageKey } from "./error-mapping";

test("maps every known lesson backend error code to its message key", () => {
  const cases: Array<[string, string]> = [
    ["COURSE_NOT_FOUND", "courses.detailNotFound"],
    ["SECTION_NOT_FOUND", "sections.notFoundError"],
    ["LESSON_NOT_FOUND", "lessons.notFoundError"],
    ["INVALID_LESSON_LIFECYCLE_TRANSITION", "lessons.errorInvalidTransition"],
    ["LESSON_CONTENT_NOT_READY", "lessons.errorContentNotReady"],
    ["LESSON_POSITION_CONFLICT", "lessons.errorPositionConflict"],
    ["INVALID_LESSON_REORDER", "lessons.errorInvalidReorder"],
    ["INVALID_LESSON_TYPE_REFERENCE", "lessons.errorInvalidTypeReference"],
    ["LESSON_REFERENCE_NOT_FOUND", "lessons.errorReferenceNotFound"],
    ["VALIDATION_FAILED", "courses.errorValidation"],
  ];

  for (const [code, expectedKey] of cases) {
    const error = new ApiError({ kind: "backend", code, message: "backend detail message", status: 409 });
    assert.equal(resolveErrorMessageKey(error, "lessons.createErrorGeneric"), expectedKey);
  }
});

test("falls back to the caller's fallback key for an unmapped backend error code", () => {
  const error = new ApiError({ kind: "backend", code: "SOME_UNMAPPED_CODE", message: "detail", status: 500 });
  assert.equal(resolveErrorMessageKey(error, "lessons.createErrorGeneric"), "lessons.createErrorGeneric");
});

test("falls back to the caller's fallback key for a non-ApiError value", () => {
  assert.equal(resolveErrorMessageKey(new Error("boom"), "lessons.editErrorGeneric"), "lessons.editErrorGeneric");
});

test("identifies a lesson lifecycle-conflict response, driving the stale-page refetch", () => {
  const conflict = new ApiError({ kind: "backend", code: "INVALID_LESSON_LIFECYCLE_TRANSITION", message: "detail", status: 409 });
  assert.equal(isLessonLifecycleConflict(conflict), true);
});

test("does not treat LESSON_CONTENT_NOT_READY or other codes as a lifecycle conflict - it's a distinct, separately-mapped readiness failure", () => {
  const notReady = new ApiError({ kind: "backend", code: "LESSON_CONTENT_NOT_READY", message: "detail", status: 409 });
  const notFound = new ApiError({ kind: "backend", code: "LESSON_NOT_FOUND", message: "detail", status: 404 });
  const networkError = new ApiError({ kind: "network", code: "NETWORK_UNAVAILABLE", message: "offline" });

  assert.equal(isLessonLifecycleConflict(notReady), false);
  assert.equal(isLessonLifecycleConflict(notFound), false);
  assert.equal(isLessonLifecycleConflict(networkError), false);
  assert.equal(isLessonLifecycleConflict(new Error("boom")), false);
  assert.equal(isLessonLifecycleConflict(null), false);
});

test("re-exports the shared network-error check rather than redefining it", () => {
  const networkError = new ApiError({ kind: "network", code: "NETWORK_UNAVAILABLE", message: "offline" });
  const backendError = new ApiError({ kind: "backend", code: "LESSON_NOT_FOUND", message: "detail", status: 404 });

  assert.equal(isNetworkError(networkError), true);
  assert.equal(isNetworkError(backendError), false);
});
