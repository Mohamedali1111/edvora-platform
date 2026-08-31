/**
 * Availability (`availableFrom`/`availableUntil`) is a full `timestamptz`
 * instant on the backend - student entitlement compares it against
 * `now = new Date()` at second precision, not a calendar date - so the UI
 * must round-trip a real time-of-day, not just a day. These helpers convert
 * between that ISO instant and `<input type="datetime-local">`, which reads
 * and writes in the browser's own local time zone; the local offset is
 * applied deliberately in both directions (via native `Date` local
 * getters/parsing) rather than treating the UTC instant as if it were
 * already local wall-clock time.
 */
export function toDateTimeLocalValue(iso: string | null): string {
  if (!iso) {
    return "";
  }

  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Returns `null` for an empty input (clears the field - the PATCH contract accepts explicit `null`), or a full UTC ISO instant otherwise. */
export function fromDateTimeLocalValue(value: string): string | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

/**
 * Read-only display for an availability instant - unlike the shared
 * `students/format.ts` `formatDate` (date-only, used where only the day
 * matters, e.g. `createdAt`), this includes the local time-of-day so the
 * lesson row doesn't visually collapse the real gating instant down to a
 * bare date.
 */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

/** Renders a whole-second duration as `m:ss` (or `h:mm:ss` past an hour). */
export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  const paddedSeconds = String(remainingSeconds).padStart(2, "0");

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${paddedSeconds}`;
  }

  return `${minutes}:${paddedSeconds}`;
}
