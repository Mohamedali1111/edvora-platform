import { Upload } from "tus-js-client";
import type { VideoUploadIntent } from "../../../lib/api/types";

export type TusUploadOptions = {
  endpoint: string;
  headers: Record<string, string>;
  metadata: Record<string, string>;
  retryDelays: number[];
  storeFingerprintForResuming: false;
};

/**
 * Pure mapping from the backend's issued capability plus the chosen file to
 * tus-js-client's options - kept separate from `createTusUpload` so this
 * mapping is unit-testable without a real tus-js-client instance or
 * network. Only capability material the backend actually returned
 * (`intent.tusEndpoint`, `intent.headers` -
 * `AuthorizationSignature`/`AuthorizationExpire`/`VideoId`/`LibraryId`) is
 * used - no Bunny API key, webhook signing secret, or any other private
 * provider credential is ever read, invented, or embedded here.
 * `metadata.filetype` is the file's own declared MIME type - not a secret -
 * included because Bunny's TUS integration expects it so the pipeline knows
 * the container format before encoding starts. A small built-in
 * `retryDelays` backoff lets a brief network blip resume the same upload
 * automatically, matching Bunny's TUS endpoint being resumable by design.
 *
 * `storeFingerprintForResuming: false` is deliberate and load-bearing, not
 * a default left alone: tus-js-client's browser build defaults this to
 * `true` and, whenever `localStorage` is available (`canStoreURLs`, true in
 * virtually every real browser), automatically persists `{size, metadata,
 * creationTime, uploadUrl}` to it on every upload start/chunk - verified
 * directly from the installed v4.3.1 source
 * (`node_modules/tus-js-client/lib/upload.js`'s `_saveUploadInUrlStorage`
 * and `lib/browser/index.js`'s `defaultOptions`). It does not persist the
 * `headers` we pass (Bunny's four authorization headers never reach
 * storage), but it does persist the per-upload resumable `uploadUrl`, and
 * critically does **not** remove that entry on success by default
 * (`removeFingerprintOnSuccess` also defaults `false`). Edvora's V1 upload
 * authorization is issued by the backend, time-limited via `expiresAt`, and
 * deliberately not designed for cross-reload resumption - so persisting any
 * of it to `localStorage` would outlive the intended single-session
 * capability lifetime for no benefit this product currently uses.
 * `findPreviousUploads()`/`resumeFromPreviousUpload()` (the APIs that would
 * read this back) are never called anywhere in this feature either - this
 * option's job is solely to stop tus-js-client writing in the first place.
 */
export function buildTusUploadOptions(intent: VideoUploadIntent, file: File): TusUploadOptions {
  return {
    endpoint: intent.tusEndpoint,
    headers: intent.headers,
    metadata: { filetype: file.type || "video/mp4" },
    retryDelays: [0, 1000, 3000, 5000],
    storeFingerprintForResuming: false,
  };
}

export type TusUploadHandle = {
  start: () => void;
  abort: () => void;
};

/**
 * Thin wrapper around tus-js-client's `Upload` - the only place this
 * feature touches the dependency directly, so swapping/upgrading it stays
 * localized. Bytes go straight from the browser to Bunny's TUS endpoint;
 * they never pass through the Edvora API (see docs/MEDIA.md). Reaching
 * `onSuccess` here means only that the bytes finished uploading to Bunny -
 * it is deliberately not treated as "the video is ready": Bunny's
 * webhook-driven processing is a separate, later state the caller must
 * still poll/refresh for (see polling.ts).
 */
export function createTusUpload(
  intent: VideoUploadIntent,
  file: File,
  callbacks: {
    onProgress: (bytesSent: number, bytesTotal: number) => void;
    onSuccess: () => void;
    onError: (error: Error) => void;
  },
): TusUploadHandle {
  const options = buildTusUploadOptions(intent, file);
  const upload = new Upload(file, {
    endpoint: options.endpoint,
    headers: options.headers,
    metadata: options.metadata,
    retryDelays: options.retryDelays,
    storeFingerprintForResuming: options.storeFingerprintForResuming,
    onProgress: callbacks.onProgress,
    onSuccess: () => callbacks.onSuccess(),
    onError: callbacks.onError,
  });

  return {
    start: () => upload.start(),
    abort: () => {
      void upload.abort();
    },
  };
}
