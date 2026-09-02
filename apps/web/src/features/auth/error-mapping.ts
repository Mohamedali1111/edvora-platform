import { ApiError } from "../../lib/api/client";
import type { TranslationKey } from "@/lib/i18n/translations";

/**
 * Maps POST /auth/activate's backend error `code` (from the uniform `{ error: { code, message
 * } }` envelope) to a translated message key. The backend deliberately collapses
 * ACTIVATION_TOKEN_INVALID/EXPIRED/CONSUMED into the single wire code `ACTIVATION_TOKEN_INVALID`
 * (see apps/api/src/modules/auth/http/auth-error-mapping.ts's `TOKEN_ERROR_CODES` handling) so a
 * caller can never learn whether a wrong code was merely mistyped, already used, or simply old.
 * This client mirrors that exactly rather than inventing a finer-grained distinction the backend
 * does not provide - Student Mobile's own activation error mapping makes the identical choice
 * (apps/mobile/src/features/auth/error-mapping.ts's `mapActivationError`).
 */
const KNOWN_ERROR_CODE_KEYS: Partial<Record<string, TranslationKey>> = {
  ACTIVATION_TOKEN_INVALID: "auth.activate.error.tokenInvalid",
  PASSWORD_POLICY_REJECTED: "auth.activate.error.passwordPolicyRejected",
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
