import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "../../../lib/api/client";
import { isQuizLifecycleConflict, isQuizPublishabilityConflict, resolveErrorMessageKey } from "./error-mapping";

test("maps known quiz authoring backend error codes to safe translation keys", () => {
  assert.equal(resolveErrorMessageKey(backend("QUIZ_NOT_FOUND"), "quizzes.createErrorGeneric"), "quizzes.errorQuizNotFound");
  assert.equal(resolveErrorMessageKey(backend("QUESTION_NOT_FOUND"), "quizzes.createErrorGeneric"), "quizzes.errorQuestionNotFound");
  assert.equal(resolveErrorMessageKey(backend("QUESTION_OPTION_NOT_FOUND"), "quizzes.createErrorGeneric"), "quizzes.errorOptionNotFound");
  assert.equal(resolveErrorMessageKey(backend("INVALID_QUIZ_LIFECYCLE_TRANSITION"), "quizzes.createErrorGeneric"), "quizzes.errorInvalidTransition");
  assert.equal(resolveErrorMessageKey(backend("QUIZ_NOT_PUBLISHABLE"), "quizzes.createErrorGeneric"), "quizzes.errorNotPublishable");
  assert.equal(resolveErrorMessageKey(backend("INVALID_QUESTION_REORDER"), "quizzes.createErrorGeneric"), "quizzes.errorQuestionReorder");
  assert.equal(resolveErrorMessageKey(backend("INVALID_QUESTION_OPTION_REORDER"), "quizzes.createErrorGeneric"), "quizzes.errorOptionReorder");
  assert.equal(resolveErrorMessageKey(backend("MULTIPLE_CORRECT_OPTIONS_NOT_ALLOWED"), "quizzes.createErrorGeneric"), "quizzes.errorCorrectness");
});

test("falls back without exposing raw backend messages", () => {
  assert.equal(resolveErrorMessageKey(backend("UNMAPPED"), "quizzes.createErrorGeneric"), "quizzes.createErrorGeneric");
});

test("distinguishes lifecycle conflicts and publishability conflicts for authoritative refetch", () => {
  assert.equal(isQuizLifecycleConflict(backend("INVALID_QUIZ_LIFECYCLE_TRANSITION")), true);
  assert.equal(isQuizLifecycleConflict(backend("QUIZ_NOT_PUBLISHABLE")), false);
  assert.equal(isQuizPublishabilityConflict(backend("QUIZ_NOT_PUBLISHABLE")), true);
  assert.equal(isQuizPublishabilityConflict(backend("INVALID_QUIZ_LIFECYCLE_TRANSITION")), false);
});

function backend(code: string): ApiError {
  return new ApiError({ kind: "backend", status: 409, code, message: "raw backend message" });
}
