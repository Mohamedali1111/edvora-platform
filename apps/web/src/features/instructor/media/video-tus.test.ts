import assert from "node:assert/strict";
import test from "node:test";
import type { VideoUploadIntent } from "../../../lib/api/types";
import { buildTusUploadOptions } from "./video-tus";

const INTENT: VideoUploadIntent = {
  videoAssetId: "v1",
  tusEndpoint: "https://video.bunnycdn.com/tusupload",
  expiresAt: "2026-01-01T00:00:00.000Z",
  headers: {
    AuthorizationSignature: "deadbeef",
    AuthorizationExpire: "1735689600",
    VideoId: "v1",
    LibraryId: "lib1",
  },
  provider: { bunnyStream: { libraryId: "lib1", videoId: "v1" } },
};

function fakeFile(type: string, size: number): File {
  return { type, size, name: "lecture.mp4" } as File;
}

test("uses exactly the backend-issued endpoint and headers - never a client-constructed URL or signature", () => {
  const options = buildTusUploadOptions(INTENT, fakeFile("video/mp4", 1024));

  assert.equal(options.endpoint, INTENT.tusEndpoint);
  assert.deepEqual(options.headers, INTENT.headers);
});

test("never invents or embeds a private provider credential - only the four capability headers the backend returned are present", () => {
  const options = buildTusUploadOptions(INTENT, fakeFile("video/mp4", 1024));

  assert.deepEqual(Object.keys(options.headers).sort(), ["AuthorizationExpire", "AuthorizationSignature", "LibraryId", "VideoId"]);
});

test("metadata carries only the file's own declared MIME type - not a title, not any identity/credential", () => {
  const options = buildTusUploadOptions(INTENT, fakeFile("video/quicktime", 2048));

  assert.deepEqual(options.metadata, { filetype: "video/quicktime" });
});

test("falls back to a default filetype when the browser could not determine one, rather than sending an empty value", () => {
  const options = buildTusUploadOptions(INTENT, fakeFile("", 2048));

  assert.equal(options.metadata.filetype, "video/mp4");
});

test("configures a small bounded retry backoff so a transient network blip can resume the same upload", () => {
  const options = buildTusUploadOptions(INTENT, fakeFile("video/mp4", 1024));

  assert.ok(Array.isArray(options.retryDelays));
  assert.ok(options.retryDelays.length > 0);
});

test("explicitly disables tus-js-client's default browser localStorage resume persistence", () => {
  // tus-js-client's browser build defaults `storeFingerprintForResuming` to
  // `true` and, whenever localStorage is available, automatically persists
  // `{size, metadata, creationTime, uploadUrl}` on every upload start/chunk
  // (verified directly from the installed v4.3.1 source). Edvora's V1
  // upload authorization is backend-issued, time-limited, and deliberately
  // not designed for cross-reload resumption, so this must be explicitly
  // set to `false` here rather than left at its default.
  const options = buildTusUploadOptions(INTENT, fakeFile("video/mp4", 1024));

  assert.equal(options.storeFingerprintForResuming, false);
});
