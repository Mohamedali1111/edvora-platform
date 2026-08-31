import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "../../../lib/api/client";
import { isNetworkError, resolveErrorMessageKey } from "./error-mapping";

test("maps every known students/enrollments backend error code to its message key", () => {
  const cases: Array<[string, string]> = [
    ["IDENTITY_ROLE_CONFLICT", "students.addErrorRoleConflict"],
    ["TENANT_STUDENT_NOT_FOUND", "students.detailNotFound"],
    ["STUDENT_REQUIRED", "enrollments.errorStudentRequired"],
    ["COURSE_NOT_FOUND", "enrollments.errorCourseNotFound"],
    ["ENROLLMENT_ALREADY_ACTIVE", "enrollments.errorAlreadyActive"],
    ["ENROLLMENT_NOT_FOUND", "enrollments.errorNotFound"],
  ];

  for (const [code, expectedKey] of cases) {
    const error = new ApiError({ kind: "backend", code, message: "backend detail message", status: 409 });
    assert.equal(resolveErrorMessageKey(error, "students.addErrorGeneric"), expectedKey);
  }
});

test("falls back to the caller's fallback key for an unmapped backend error code", () => {
  const error = new ApiError({ kind: "backend", code: "SOME_UNMAPPED_CODE", message: "detail", status: 500 });
  assert.equal(resolveErrorMessageKey(error, "students.addErrorGeneric"), "students.addErrorGeneric");
});

test("falls back to the caller's fallback key for a non-ApiError value", () => {
  assert.equal(resolveErrorMessageKey(new Error("boom"), "enrollments.createErrorGeneric"), "enrollments.createErrorGeneric");
  assert.equal(resolveErrorMessageKey(null, "enrollments.createErrorGeneric"), "enrollments.createErrorGeneric");
});

test("never leaks the raw backend message - only the mapped translation key is ever returned", () => {
  const error = new ApiError({ kind: "backend", code: "COURSE_NOT_FOUND", message: "Course row 8f2c not found in tenant 771a", status: 404 });
  const key = resolveErrorMessageKey(error, "enrollments.createErrorGeneric");
  assert.equal(key.includes("8f2c"), false);
  assert.equal(key, "enrollments.errorCourseNotFound");
});

test("identifies network failures distinctly from backend failures", () => {
  const networkError = new ApiError({ kind: "network", code: "NETWORK_UNAVAILABLE", message: "offline" });
  const backendError = new ApiError({ kind: "backend", code: "COURSE_NOT_FOUND", message: "detail", status: 404 });

  assert.equal(isNetworkError(networkError), true);
  assert.equal(isNetworkError(backendError), false);
  assert.equal(isNetworkError(new Error("boom")), false);
});
