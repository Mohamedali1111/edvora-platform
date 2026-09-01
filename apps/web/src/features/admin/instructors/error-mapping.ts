import { ApiError } from "@/lib/api/client";
import type { TranslationKey } from "@/lib/i18n/translations";

export { isNetworkError } from "../error-mapping";

/**
 * Maps a frozen backend error `code` (from the uniform `{ error: { code,
 * message } }` envelope) to a translated, user-facing message key. Only
 * codes /admin/instructors can actually return (see
 * apps/api/src/modules/tenancy/errors/tenancy.errors.ts and
 * http/tenancy-error-mapping.ts) are mapped; everything else falls back to
 * a generic recoverable message. Never surfaces the raw backend `message`
 * string to the UI.
 */
const KNOWN_ERROR_CODE_KEYS: Partial<Record<string, TranslationKey>> = {
  IDENTITY_ROLE_CONFLICT: "admin.instructors.errorRoleConflict",
  INSTRUCTOR_ALREADY_EXISTS: "admin.instructors.errorAlreadyExists",
  TENANT_SLUG_ALREADY_EXISTS: "admin.instructors.errorSlugExists",
  INSTRUCTOR_NOT_FOUND: "admin.instructors.detailNotFound",
  PLATFORM_ADMIN_REQUIRED: "admin.instructors.errorForbidden",
  VALIDATION_FAILED: "admin.instructors.errorValidation",
};

export function resolveErrorMessageKey(error: unknown, fallback: TranslationKey): TranslationKey {
  if (error instanceof ApiError && error.kind === "backend") {
    return KNOWN_ERROR_CODE_KEYS[error.code] ?? fallback;
  }

  return fallback;
}
