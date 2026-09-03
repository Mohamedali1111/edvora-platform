/**
 * Client-side mirrors of the frozen backend's exact V1 document constraints
 * (`DOCUMENT_UPLOAD_ALLOWED_MIME_TYPES`/`DOCUMENT_UPLOAD_MAX_FILE_SIZE_BYTES`
 * in apps/api/.../media/dto/document-upload.dto.ts). These are a UX
 * shortcut only - rejecting an obviously-invalid file before spending a
 * network round trip - never the trust boundary: the backend re-validates
 * independently and remains authoritative. No PDF magic-byte/content
 * sniffing is done here, matching the backend's own documented trust
 * boundary (docs/MEDIA.md's "PDF Content Verification Trust Boundary").
 */
export const DOCUMENT_ALLOWED_MIME_TYPES = ["application/pdf"] as const;
export const DOCUMENT_MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;

export type DocumentFileValidationError = "EMPTY" | "INVALID_TYPE" | "TOO_LARGE";

export function validateDocumentFile(file: { type: string; size: number }): DocumentFileValidationError | null {
  if (file.size <= 0) {
    return "EMPTY";
  }

  if (!DOCUMENT_ALLOWED_MIME_TYPES.includes(file.type as (typeof DOCUMENT_ALLOWED_MIME_TYPES)[number])) {
    return "INVALID_TYPE";
  }

  if (file.size > DOCUMENT_MAX_FILE_SIZE_BYTES) {
    return "TOO_LARGE";
  }

  return null;
}

/**
 * Whether a backend-issued upload capability's `expiresAt` has passed -
 * i.e. whether it is still usable for a same-capability retry (a transient
 * network/provider failure before the upload otherwise completed). Generic
 * over both upload flows: a presigned R2 `PUT` capability
 * (`DocumentUploadIntent`, before `confirmDocumentUpload` was ever
 * attempted) and a Bunny TUS capability (`VideoUploadIntent`, see
 * upload-video-dialog.tsx) share the exact same immutable,
 * backend-issued/time-limited shape and the exact same policy: once
 * expired, retrying against the same capability cannot succeed - the
 * caller must start over with a brand new upload intent instead of
 * indefinitely retrying an authorization the provider will keep rejecting.
 */
export function isUploadCapabilityExpired(expiresAtIso: string, now: Date): boolean {
  const expiresAt = new Date(expiresAtIso);
  return Number.isNaN(expiresAt.getTime()) || now.getTime() >= expiresAt.getTime();
}

export type DocumentUploadTransportError = { kind: "network" } | { kind: "http"; status: number } | { kind: "aborted" };

/**
 * Whether a failed direct-to-R2 `PUT` is ambiguous - i.e. whether the bytes
 * may have actually reached R2 despite the browser reporting a transport
 * failure. `xhr.onerror` (`{kind:"network"}`) fires for cases that do not
 * prove the request never arrived server-side - a connection reset *after*
 * the request body finished sending, a missing CORS response-exposure
 * header on an otherwise-successful response, a proxy hiccup on the reply
 * but not the request - so it must never be reported to the instructor as a
 * definitive failure. `{kind:"http"}` (a real non-2xx status R2 itself
 * returned) and `{kind:"aborted"}` (the instructor/dialog cancelled it) are
 * both unambiguous and are not covered by this - see upload-document-dialog.tsx,
 * which reconciles an ambiguous failure against authoritative backend state
 * (the same idempotent `confirmDocumentUpload` call already used for the
 * happy path) instead of ever guessing.
 */
export function isAmbiguousPutFailure(error: DocumentUploadTransportError): boolean {
  return error.kind === "network";
}

/**
 * Whether a failed PUT was a deliberate, known instructor cancellation
 * (`{kind:"aborted"}`, from `uploadDocumentBytes`'s `xhr.onabort` -
 * see the `signal` parameter above, wired by `cancelUpload` in
 * use-document-upload-flow.ts) rather than an unexplained transport
 * failure. Unlike `isAmbiguousPutFailure`, this is never ambiguous: the
 * instructor's own intent is already known, so it is reported honestly as
 * "cancelled" - never reconciled, never shown as a failure.
 */
export function isUserCancelledPut(error: DocumentUploadTransportError): boolean {
  return error.kind === "aborted";
}

/**
 * Performs the direct-to-R2 `PUT` using exactly the `uploadUrl`/`headers`
 * capability the backend issued - no signing logic, no provider SDK, no
 * credentials constructed client-side. `XMLHttpRequest` is used (not
 * `fetch`) solely because it is the only browser-standard API that exposes
 * upload progress events; `fetch`'s request-body streaming/progress support
 * is not reliably available across supported browsers. This is a small,
 * isolated transport helper - not a general HTTP client - and is never
 * routed through `ApiClient`, since this request goes straight to Cloudflare
 * R2, not the Edvora API (no Authorization bearer token, no credentials).
 */
export function uploadDocumentBytes(
  uploadUrl: string,
  headers: Record<string, string>,
  file: File,
  onProgress?: (loadedBytes: number, totalBytes: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUrl, true);

    for (const [name, value] of Object.entries(headers)) {
      xhr.setRequestHeader(name, value);
    }

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(event.loaded, event.total);
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject({ kind: "http", status: xhr.status } satisfies DocumentUploadTransportError);
      }
    };

    xhr.onerror = () => {
      reject({ kind: "network" } satisfies DocumentUploadTransportError);
    };

    xhr.onabort = () => {
      reject({ kind: "aborted" } satisfies DocumentUploadTransportError);
    };

    if (signal) {
      if (signal.aborted) {
        xhr.abort();
        return;
      }

      signal.addEventListener("abort", () => xhr.abort(), { once: true });
    }

    xhr.send(file);
  });
}
