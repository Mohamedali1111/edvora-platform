export type ActivationFieldErrors = {
  activationToken?: "required";
  newPassword?: "required" | "tooShort";
  confirmPassword?: "mismatch";
};

/**
 * Matches the backend's actual enforced policy exactly (`DEFAULT_PASSWORD_POLICY.minLength` in
 * apps/api/src/modules/auth/auth.config.ts, enforced by `PasswordService.assertPasswordPolicy`)
 * - a fast client-side check only, never the trust boundary; the backend re-validates
 * independently and remains authoritative. Mirrors the exact same constant Student Mobile's own
 * activation form already uses (apps/mobile/src/features/auth/validate.ts).
 */
export const MIN_PASSWORD_LENGTH = 12;

export function validateActivationInput(input: {
  activationToken: string;
  newPassword: string;
  confirmPassword: string;
}): ActivationFieldErrors {
  const errors: ActivationFieldErrors = {};

  if (!input.activationToken.trim()) {
    errors.activationToken = "required";
  }

  if (!input.newPassword) {
    errors.newPassword = "required";
  } else if (input.newPassword.length < MIN_PASSWORD_LENGTH) {
    errors.newPassword = "tooShort";
  }

  if (!errors.newPassword && input.newPassword !== input.confirmPassword) {
    errors.confirmPassword = "mismatch";
  }

  return errors;
}
