import { ApiError } from "../../../lib/api/client";
import type { TranslationKey } from "../../../lib/i18n/translations";

export { isNetworkError } from "../students/error-mapping";

/**
 * Maps a frozen backend `MediaErrorCode` (from the uniform `{ error: {
 * code, message } }` envelope - see apps/api/.../media/errors/media.errors.ts)
 * to a translated, user-facing message key. Only codes this feature's
 * endpoints can actually return are mapped; everything else falls back to
 * a generic recoverable message. Never surfaces the raw backend `message`
 * string, and never a storage key/provider detail.
 */
const KNOWN_ERROR_CODE_KEYS: Partial<Record<string, TranslationKey>> = {
  VIDEO_ASSET_NOT_FOUND: "media.errorVideoNotFound",
  DOCUMENT_ASSET_NOT_FOUND: "media.errorDocumentNotFound",
  UNSUPPORTED_DOCUMENT_MIME_TYPE: "media.errorUnsupportedMimeType",
  DOCUMENT_UPLOAD_NOT_FOUND: "media.errorUploadNotFound",
  DOCUMENT_UPLOAD_VERIFICATION_FAILED: "media.errorVerificationFailed",
  DOCUMENT_UPLOAD_SIGNING_FAILED: "media.errorSigningFailed",
  VIDEO_UPLOAD_SIGNING_FAILED: "media.errorSigningFailed",
  VALIDATION_FAILED: "media.errorValidation",
};

export function resolveErrorMessageKey(error: unknown, fallback: TranslationKey): TranslationKey {
  if (error instanceof ApiError && error.kind === "backend") {
    return KNOWN_ERROR_CODE_KEYS[error.code] ?? fallback;
  }

  return fallback;
}
