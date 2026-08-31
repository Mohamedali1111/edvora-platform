/**
 * Client-side mirror of the backend's AddStudentDto constraints
 * (@IsEmail, @MaxLength(320) on email; @MaxLength(160) on displayName) - the
 * backend remains authoritative; this only gives fast, friendly feedback
 * before a round trip.
 */
export function validateAddStudentInput(
  email: string,
  displayName: string,
): { email?: "required" | "invalid"; displayName?: "tooLong" } {
  const errors: { email?: "required" | "invalid"; displayName?: "tooLong" } = {};
  const trimmedEmail = email.trim();

  if (!trimmedEmail) {
    errors.email = "required";
  } else if (trimmedEmail.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
    errors.email = "invalid";
  }

  if (displayName.trim().length > 160) {
    errors.displayName = "tooLong";
  }

  return errors;
}
