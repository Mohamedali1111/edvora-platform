/** Renders a backend ISO timestamp using the viewer's locale/timezone, including time-of-day. Falls back to the raw string if unparsable. */
export function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
