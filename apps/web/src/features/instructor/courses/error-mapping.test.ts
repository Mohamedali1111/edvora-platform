import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "../../../lib/api/client";
import type { ReadinessIssue } from "../../../lib/api/types";
import {
  extractStaleBlockers,
  isCourseAlreadyPublishedOnce,
  isCourseLifecycleConflict,
  isNetworkError,
  isPublishSelectionStale,
  resolveErrorMessageKey,
} from "./error-mapping";

test("maps every known course backend error code to its message key", () => {
  const cases: Array<[string, string]> = [
    ["COURSE_NOT_FOUND", "courses.detailNotFound"],
    ["INVALID_COURSE_LIFECYCLE_TRANSITION", "courses.errorInvalidTransition"],
    ["COURSE_ALREADY_PUBLISHED_ONCE", "courses.errorAlreadyPublishedOnce"],
    ["PUBLISH_SELECTION_STALE", "courses.publishReviewStaleExplain"],
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

test("identifies COURSE_ALREADY_PUBLISHED_ONCE specifically, distinct from an ordinary lifecycle conflict", () => {
  const alreadyPublished = new ApiError({ kind: "backend", code: "COURSE_ALREADY_PUBLISHED_ONCE", message: "detail", status: 409 });
  assert.equal(isCourseAlreadyPublishedOnce(alreadyPublished), true);
  assert.equal(isCourseLifecycleConflict(alreadyPublished), false);

  const conflict = new ApiError({ kind: "backend", code: "INVALID_COURSE_LIFECYCLE_TRANSITION", message: "detail", status: 409 });
  assert.equal(isCourseAlreadyPublishedOnce(conflict), false);
});

test("PUBLISH_SELECTION_STALE parsing: identifies the code and extracts its blockers", () => {
  const blockers: ReadinessIssue[] = [
    { reasonCode: "LESSON_NOT_SELECTABLE", entityType: "LESSON", entityId: "lesson-1", title: "Intro" },
  ];
  const stale = new ApiError({
    kind: "backend",
    code: "PUBLISH_SELECTION_STALE",
    message: "detail",
    status: 409,
    details: { blockers },
  });

  assert.equal(isPublishSelectionStale(stale), true);
  assert.deepEqual(extractStaleBlockers(stale), blockers);
});

test("extractStaleBlockers returns null for non-stale errors, missing details, or a malformed blockers field", () => {
  const notStale = new ApiError({ kind: "backend", code: "COURSE_NOT_FOUND", message: "detail", status: 404 });
  assert.equal(extractStaleBlockers(notStale), null);

  const staleWithoutDetails = new ApiError({ kind: "backend", code: "PUBLISH_SELECTION_STALE", message: "detail", status: 409 });
  assert.equal(extractStaleBlockers(staleWithoutDetails), null);

  const staleWithMalformedBlockers = new ApiError({
    kind: "backend",
    code: "PUBLISH_SELECTION_STALE",
    message: "detail",
    status: 409,
    details: { blockers: "not-an-array" },
  });
  assert.equal(extractStaleBlockers(staleWithMalformedBlockers), null);

  assert.equal(extractStaleBlockers(new Error("boom")), null);
  assert.equal(extractStaleBlockers(null), null);
});
