import { ApiError } from "../../../lib/api/client";
import type { TranslationKey } from "../../../lib/i18n/translations";

/**
 * Maps a frozen backend error `code` (from the uniform `{ error: { code,
 * message } }` envelope - see lib/api/client.ts) to a translated,
 * user-facing message key. Only codes this feature area can actually
 * receive are mapped; everything else - including network failures, which
 * callers should check separately, same convention as login-form.tsx - falls
 * back to a generic recoverable message. Never surfaces the raw backend
 * `message` string to the UI.
 */
const KNOWN_ERROR_CODE_KEYS: Partial<Record<string, TranslationKey>> = {
  IDENTITY_ROLE_CONFLICT: "students.addErrorRoleConflict",
  TENANT_STUDENT_NOT_FOUND: "students.detailNotFound",
  STUDENT_REQUIRED: "enrollments.errorStudentRequired",
  COURSE_NOT_FOUND: "enrollments.errorCourseNotFound",
  ENROLLMENT_ALREADY_ACTIVE: "enrollments.errorAlreadyActive",
  ENROLLMENT_NOT_FOUND: "enrollments.errorNotFound",
};

export function resolveErrorMessageKey(error: unknown, fallback: TranslationKey): TranslationKey {
  if (error instanceof ApiError && error.kind === "backend") {
    return KNOWN_ERROR_CODE_KEYS[error.code] ?? fallback;
  }

  return fallback;
}

export function isNetworkError(error: unknown): boolean {
  return error instanceof ApiError && error.kind === "network";
}
