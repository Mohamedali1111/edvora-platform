import type { UpdateLessonRequest } from "@/lib/api/types";
import { fromDateTimeLocalValue } from "./format";

/**
 * The Edit Lesson form's "as loaded" snapshot for the two availability
 * fields - the exact `datetime-local` input value each field was seeded
 * with (via `toDateTimeLocalValue`) when the dialog opened, captured once
 * and never itself updated as the user types.
 */
export type LessonAvailabilitySnapshot = {
  availableFromInput: string;
  availableUntilInput: string;
};

export type LessonEditFormValues = {
  title: string;
  description: string;
  availableFromInput: string;
  availableUntilInput: string;
};

/**
 * Builds the PATCH body for Edit Lesson.
 *
 * `title`/`description` are always included - resending the same string is
 * lossless and harmless. `availableFrom`/`availableUntil` are included ONLY
 * when the current `datetime-local` input value differs from the value the
 * field was seeded with, because:
 *
 * - The frozen PATCH contract treats an omitted field as "leave unchanged",
 *   an explicit `null` as "clear", and a present value as "replace".
 * - `<input type="datetime-local">` cannot represent the full
 *   `timestamptz(6)` precision the backend stores (no seconds/milliseconds
 *   are shown or entered) - unconditionally resending an untouched field's
 *   input value back through `fromDateTimeLocalValue` would silently
 *   truncate any existing sub-minute precision on every save, including a
 *   save that only changed the title.
 *
 * Comparing against the seeded snapshot (rather than a separate "touched"
 * flag) means an interaction that leaves the field showing its original
 * value - clicking in and back out, or typing back to the same minute -
 * still omits the field and preserves the exact server value.
 */
export function buildLessonUpdatePayload(
  snapshot: LessonAvailabilitySnapshot,
  current: LessonEditFormValues,
): UpdateLessonRequest {
  const trimmedDescription = current.description.trim();

  return {
    title: current.title.trim(),
    description: trimmedDescription ? trimmedDescription : null,
    ...(current.availableFromInput !== snapshot.availableFromInput
      ? { availableFrom: fromDateTimeLocalValue(current.availableFromInput) }
      : {}),
    ...(current.availableUntilInput !== snapshot.availableUntilInput
      ? { availableUntil: fromDateTimeLocalValue(current.availableUntilInput) }
      : {}),
  };
}
