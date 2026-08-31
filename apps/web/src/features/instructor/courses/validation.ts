/**
 * Client-side mirror of the backend's CreateCourseDto/UpdateCourseMetadataDto
 * constraints (@MinLength(1)/@MaxLength(240) on title, @MaxLength(5000) on
 * description) - the backend remains authoritative; this only gives fast,
 * friendly feedback before a round trip.
 */
export function validateCourseInput(
  title: string,
  description: string,
): { title?: "required" | "tooLong"; description?: "tooLong" } {
  const errors: { title?: "required" | "tooLong"; description?: "tooLong" } = {};
  const trimmedTitle = title.trim();

  if (!trimmedTitle) {
    errors.title = "required";
  } else if (trimmedTitle.length > 240) {
    errors.title = "tooLong";
  }

  if (description.trim().length > 5000) {
    errors.description = "tooLong";
  }

  return errors;
}
