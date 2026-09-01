/** Renders a backend ISO date string using the viewer's locale/timezone. Falls back to the raw string if unparsable. */
export function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

/** Renders a backend ISO date string with time, for operational timestamps where the time-of-day matters. */
export function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
