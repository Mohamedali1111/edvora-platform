import type { TranslationKey } from "@/lib/i18n/translations";
import type { InstructorActivationState } from "@/lib/api/types";

/**
 * Whether "Reissue activation code" is an appropriate action for this instructor's current
 * activation state. Mirrors the backend's own gate exactly (`InstructorOnboardingService
 * .reissueActivation` rejects only `ACTIVATED` instructors with `INSTRUCTOR_ALREADY_ACTIVATED`
 * - see apps/api/.../tenancy/errors/tenancy.errors.ts) - both `PENDING_ACTIVATION` and
 * `ACTIVATION_EXPIRED` are equally eligible, since an admin may legitimately want to reissue a
 * code the instructor says they never received even before it expires. This function only
 * controls whether the UI *offers* the action; the backend remains authoritative regardless of
 * what this returns.
 */
export function canReissueActivation(state: InstructorActivationState): boolean {
  return state !== "ACTIVATED";
}

export const INSTRUCTOR_ACTIVATION_STATE_KEY: Record<InstructorActivationState, TranslationKey> = {
  PENDING_ACTIVATION: "admin.instructors.activationStatePending",
  ACTIVATED: "admin.instructors.activationStateActivated",
  ACTIVATION_EXPIRED: "admin.instructors.activationStateExpired",
};
