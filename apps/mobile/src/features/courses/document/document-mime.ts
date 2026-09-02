/**
 * The accepted Student Document upload contract is PDF-only (see
 * apps/api/src/modules/media/dto/document-upload.dto.ts's
 * `DOCUMENT_UPLOAD_ALLOWED_MIME_TYPES`) — mirrored here as the one MIME type
 * this client will attempt to render. A `mimeType` outside this set on a
 * `/document/access` response means the backend has moved beyond the frozen
 * V1 contract this client was built against; failing safely with an honest
 * "unsupported document" state (see document-lesson-screen.tsx) is correct
 * here, not a bug to silently work around by broadening this set.
 */
export const SUPPORTED_DOCUMENT_MIME_TYPES = ['application/pdf'] as const;

export function isSupportedDocumentMime(mimeType: string): boolean {
  return (SUPPORTED_DOCUMENT_MIME_TYPES as readonly string[]).includes(mimeType);
}
