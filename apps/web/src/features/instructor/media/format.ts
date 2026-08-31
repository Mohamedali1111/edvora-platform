/**
 * Renders a byte count (as returned by `DocumentAssetSummary.fileSizeBytes`,
 * a decimal string since it's a Postgres `bigint`) as a short human-readable
 * size. Binary (1024-based) units, matching how the backend's own 25 MiB
 * limit is expressed (`DOCUMENT_UPLOAD_MAX_FILE_SIZE_BYTES = 25 * 1024 *
 * 1024`) - never a fabricated decimal-GB approximation.
 */
export function formatFileSize(bytes: number | string): string {
  const value = typeof bytes === "string" ? Number(bytes) : bytes;

  if (!Number.isFinite(value) || value < 0) {
    return "";
  }

  const units = ["B", "KiB", "MiB", "GiB"];
  let size = value;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  const precision = unitIndex === 0 ? 0 : 1;
  return `${size.toFixed(precision)} ${units[unitIndex]}`;
}
