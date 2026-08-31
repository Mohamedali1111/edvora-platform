import assert from "node:assert/strict";
import test from "node:test";
import { DOCUMENT_MAX_FILE_SIZE_BYTES, isUploadCapabilityExpired, validateDocumentFile } from "./document-upload";

test("accepts a valid PDF within the size limit", () => {
  assert.equal(validateDocumentFile({ type: "application/pdf", size: 1024 }), null);
  assert.equal(validateDocumentFile({ type: "application/pdf", size: DOCUMENT_MAX_FILE_SIZE_BYTES }), null);
});

test("rejects an empty file before any other check", () => {
  assert.equal(validateDocumentFile({ type: "application/pdf", size: 0 }), "EMPTY");
});

test("rejects a non-PDF MIME type, matching the backend's V1 PDF-only contract", () => {
  assert.equal(validateDocumentFile({ type: "image/png", size: 1024 }), "INVALID_TYPE");
  assert.equal(validateDocumentFile({ type: "application/zip", size: 1024 }), "INVALID_TYPE");
});

test("rejects a file over the exact backend maximum (25 MiB)", () => {
  assert.equal(validateDocumentFile({ type: "application/pdf", size: DOCUMENT_MAX_FILE_SIZE_BYTES + 1 }), "TOO_LARGE");
});

test("an unexpired upload capability is not treated as expired", () => {
  const now = new Date("2026-01-01T00:00:00.000Z");
  const expiresAt = new Date("2026-01-01T00:05:00.000Z").toISOString();
  assert.equal(isUploadCapabilityExpired(expiresAt, now), false);
});

test("an expired upload capability is treated as expired, forcing a fresh upload intent rather than a stale-URL retry", () => {
  const now = new Date("2026-01-01T00:10:00.000Z");
  const expiresAt = new Date("2026-01-01T00:05:00.000Z").toISOString();
  assert.equal(isUploadCapabilityExpired(expiresAt, now), true);
});

test("treats the exact expiry instant itself as already expired (>=, not >)", () => {
  const expiresAt = "2026-01-01T00:05:00.000Z";
  assert.equal(isUploadCapabilityExpired(expiresAt, new Date(expiresAt)), true);
});

/**
 * `isUploadCapabilityExpired` is intentionally generic over
 * `{expiresAtIso, now}`, not document-specific - `UploadVideoDialog` reuses
 * this exact same function against `VideoUploadIntent.expiresAt` to decide
 * whether a failed Bunny TUS upload may retry in place (same immutable,
 * backend-issued, time-limited capability shape) or must instead require a
 * brand new upload intent. These cases model that reuse directly.
 */
test("gates a video capability retry decision the same way a document capability retry decision is gated", () => {
  const issuedAt = new Date("2026-01-01T00:00:00.000Z");
  const videoExpiresAt = new Date(issuedAt.getTime() + 5 * 60_000).toISOString(); // Bunny TUS AuthorizationExpire-derived TTL

  // Still within the TUS authorization window - a retry may reuse it.
  assert.equal(isUploadCapabilityExpired(videoExpiresAt, new Date(issuedAt.getTime() + 60_000)), false);

  // Past it - a retry must not reuse it; the caller requires a new upload intent.
  assert.equal(isUploadCapabilityExpired(videoExpiresAt, new Date(issuedAt.getTime() + 6 * 60_000)), true);
});
