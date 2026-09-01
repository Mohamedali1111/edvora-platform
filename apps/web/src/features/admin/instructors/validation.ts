const TENANT_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type CreateInstructorValidationErrors = {
  email?: "required" | "invalid";
  displayName?: "tooLong";
  tenantName?: "required" | "tooLong";
  tenantSlug?: "required" | "invalid";
};

/**
 * Client-side mirror of the backend's `CreateInstructorDto` constraints
 * (@IsEmail/@MaxLength(320) on email, @MaxLength(160) on displayName,
 * tenantName 1-160 chars, tenantSlug 3-120 chars matching
 * `^[a-z0-9]+(?:-[a-z0-9]+)*$` after trim+lowercase) - the backend remains
 * authoritative; this only gives fast, friendly feedback before a round
 * trip.
 */
export function validateCreateInstructorInput(input: {
  email: string;
  displayName: string;
  tenantName: string;
  tenantSlug: string;
}): CreateInstructorValidationErrors {
  const errors: CreateInstructorValidationErrors = {};
  const trimmedEmail = input.email.trim();
  const trimmedTenantName = input.tenantName.trim();
  const normalizedSlug = input.tenantSlug.trim().toLowerCase();

  if (!trimmedEmail) {
    errors.email = "required";
  } else if (trimmedEmail.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
    errors.email = "invalid";
  }

  if (input.displayName.trim().length > 160) {
    errors.displayName = "tooLong";
  }

  if (!trimmedTenantName) {
    errors.tenantName = "required";
  } else if (trimmedTenantName.length > 160) {
    errors.tenantName = "tooLong";
  }

  if (!normalizedSlug) {
    errors.tenantSlug = "required";
  } else if (normalizedSlug.length < 3 || normalizedSlug.length > 120 || !TENANT_SLUG_PATTERN.test(normalizedSlug)) {
    errors.tenantSlug = "invalid";
  }

  return errors;
}

/** Same normalization the backend applies before validating/storing the slug - used to keep the field's live preview honest. */
export function normalizeTenantSlug(value: string): string {
  return value.trim().toLowerCase();
}
