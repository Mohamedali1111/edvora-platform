import { ApiError } from "@/lib/api/client";
import type { TranslationKey } from "@/lib/i18n/translations";

/**
 * Maps a frozen backend error `code` (from the uniform `{ error: { code,
 * message } }` envelope) to a translated, user-facing message key. Only
 * codes the device-change-requests endpoints can actually return (see
 * apps/api/src/modules/devices/errors/device.errors.ts and
 * http/device-error-mapping.ts) are mapped; everything else falls back to a
 * generic recoverable message. Never surfaces the raw backend `message`
 * string to the UI.
 */
const KNOWN_ERROR_CODE_KEYS: Partial<Record<string, TranslationKey>> = {
  DEVICE_CHANGE_REQUEST_ALREADY_RESOLVED: "admin.deviceRequests.errorAlreadyResolved",
  DEVICE_CHANGE_REQUEST_NOT_FOUND: "admin.deviceRequests.errorNotFound",
  PLATFORM_ADMIN_REQUIRED: "admin.deviceRequests.errorForbidden",
  ACCOUNT_INACTIVE: "admin.deviceRequests.errorAccountInactive",
};

/** Codes that mean "this request is no longer actionable" - the list must be refreshed rather than retried in place. */
const STALE_REQUEST_CODES = new Set(["DEVICE_CHANGE_REQUEST_ALREADY_RESOLVED", "DEVICE_CHANGE_REQUEST_NOT_FOUND"]);

export function resolveErrorMessageKey(error: unknown, fallback: TranslationKey): TranslationKey {
  if (error instanceof ApiError && error.kind === "backend") {
    return KNOWN_ERROR_CODE_KEYS[error.code] ?? fallback;
  }

  return fallback;
}

export function isStaleRequestError(error: unknown): boolean {
  return error instanceof ApiError && error.kind === "backend" && STALE_REQUEST_CODES.has(error.code);
}

export function isNetworkError(error: unknown): boolean {
  return error instanceof ApiError && error.kind === "network";
}
