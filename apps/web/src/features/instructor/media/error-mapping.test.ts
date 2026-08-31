import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "../../../lib/api/client";
import { isNetworkError, resolveErrorMessageKey } from "./error-mapping";

test("maps every known media backend error code to its message key", () => {
  const cases: Array<[string, string]> = [
    ["VIDEO_ASSET_NOT_FOUND", "media.errorVideoNotFound"],
    ["DOCUMENT_ASSET_NOT_FOUND", "media.errorDocumentNotFound"],
    ["UNSUPPORTED_DOCUMENT_MIME_TYPE", "media.errorUnsupportedMimeType"],
    ["DOCUMENT_UPLOAD_NOT_FOUND", "media.errorUploadNotFound"],
    ["DOCUMENT_UPLOAD_VERIFICATION_FAILED", "media.errorVerificationFailed"],
    ["DOCUMENT_UPLOAD_SIGNING_FAILED", "media.errorSigningFailed"],
    ["VIDEO_UPLOAD_SIGNING_FAILED", "media.errorSigningFailed"],
    ["VALIDATION_FAILED", "media.errorValidation"],
  ];

  for (const [code, expectedKey] of cases) {
    const error = new ApiError({ kind: "backend", code, message: "backend detail message", status: 502 });
    assert.equal(resolveErrorMessageKey(error, "media.errorSigningFailed"), expectedKey);
  }
});

test("falls back to the caller's fallback key for an unmapped backend error code", () => {
  const error = new ApiError({ kind: "backend", code: "SOME_UNMAPPED_CODE", message: "detail", status: 500 });
  assert.equal(resolveErrorMessageKey(error, "media.errorConfirmGeneric"), "media.errorConfirmGeneric");
});

test("falls back to the caller's fallback key for a non-ApiError value", () => {
  assert.equal(resolveErrorMessageKey(new Error("boom"), "media.errorConfirmGeneric"), "media.errorConfirmGeneric");
});

test("re-exports the shared network-error check rather than redefining it", () => {
  const networkError = new ApiError({ kind: "network", code: "NETWORK_UNAVAILABLE", message: "offline" });
  assert.equal(isNetworkError(networkError), true);
});
