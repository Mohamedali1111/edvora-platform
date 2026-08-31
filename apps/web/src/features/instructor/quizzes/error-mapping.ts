import { ApiError } from "../../../lib/api/client";
import type { TranslationKey } from "../../../lib/i18n/translations";

export { isNetworkError } from "../students/error-mapping";

export const QUIZ_LIFECYCLE_CONFLICT_CODE = "INVALID_QUIZ_LIFECYCLE_TRANSITION";
export const QUIZ_NOT_PUBLISHABLE_CODE = "QUIZ_NOT_PUBLISHABLE";

const KNOWN_ERROR_CODE_KEYS: Partial<Record<string, TranslationKey>> = {
  QUIZ_NOT_FOUND: "quizzes.errorQuizNotFound",
  QUESTION_NOT_FOUND: "quizzes.errorQuestionNotFound",
  QUESTION_OPTION_NOT_FOUND: "quizzes.errorOptionNotFound",
  INVALID_QUESTION_REORDER: "quizzes.errorQuestionReorder",
  INVALID_QUESTION_OPTION_REORDER: "quizzes.errorOptionReorder",
  QUESTION_POSITION_CONFLICT: "quizzes.errorQuestionPositionConflict",
  QUESTION_OPTION_POSITION_CONFLICT: "quizzes.errorOptionPositionConflict",
  QUESTION_OPTION_LIMIT_EXCEEDED: "quizzes.errorOptionLimit",
  MULTIPLE_CORRECT_OPTIONS_NOT_ALLOWED: "quizzes.errorCorrectness",
  [QUIZ_LIFECYCLE_CONFLICT_CODE]: "quizzes.errorInvalidTransition",
  [QUIZ_NOT_PUBLISHABLE_CODE]: "quizzes.errorNotPublishable",
  VALIDATION_FAILED: "quizzes.errorValidation",
};

export function resolveErrorMessageKey(error: unknown, fallback: TranslationKey): TranslationKey {
  if (error instanceof ApiError && error.kind === "backend") {
    return KNOWN_ERROR_CODE_KEYS[error.code] ?? fallback;
  }

  return fallback;
}

export function isQuizLifecycleConflict(error: unknown): boolean {
  return error instanceof ApiError && error.kind === "backend" && error.code === QUIZ_LIFECYCLE_CONFLICT_CODE;
}

export function isQuizPublishabilityConflict(error: unknown): boolean {
  return error instanceof ApiError && error.kind === "backend" && error.code === QUIZ_NOT_PUBLISHABLE_CODE;
}
