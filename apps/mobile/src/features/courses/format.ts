// Pure display-formatting helpers for real, already-fetched lesson metadata — never
// a source of authorization, just presentation of authoritative backend fields.

export function formatDurationSeconds(seconds: number | null): string | null {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) {
    return null;
  }

  const totalSeconds = Math.floor(seconds);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  const pad = (value: number) => String(value).padStart(2, '0');

  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`;
}

const FILE_SIZE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/**
 * `fileSizeBytes` arrives as a decimal string (the backend serializes a Prisma
 * BigInt column this way — see course-types.ts) rather than a number, since a
 * BigInt can exceed JS's safe integer range. Formatted with plain division here
 * (no BigInt math needed): document sizes are far below Number.MAX_SAFE_INTEGER in
 * practice, and this is display-only, never used for any size limit/authorization
 * decision.
 */
export function formatFileSize(bytesString: string): string {
  const bytes = Number(bytesString);

  if (!Number.isFinite(bytes) || bytes < 0) {
    return bytesString;
  }

  if (bytes === 0) {
    return '0 B';
  }

  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), FILE_SIZE_UNITS.length - 1);
  const value = bytes / 1024 ** exponent;
  const precision = exponent === 0 ? 0 : 1;

  return `${value.toFixed(precision)} ${FILE_SIZE_UNITS[exponent]}`;
}
