import assert from "node:assert/strict";
import test from "node:test";
import { formatFileSize } from "./format";

test("formats small byte counts as whole bytes", () => {
  assert.equal(formatFileSize(512), "512 B");
  assert.equal(formatFileSize(0), "0 B");
});

test("formats larger counts in the next binary unit with one decimal place", () => {
  assert.equal(formatFileSize(1024), "1.0 KiB");
  assert.equal(formatFileSize(1024 * 1024), "1.0 MiB");
});

test("accepts a decimal-string byte count (as returned by DocumentAssetSummary.fileSizeBytes, a bigint)", () => {
  assert.equal(formatFileSize("26214400"), "25.0 MiB");
});

test("returns an empty string for an unparsable or negative value rather than throwing or fabricating a size", () => {
  assert.equal(formatFileSize("not-a-number"), "");
  assert.equal(formatFileSize(-5), "");
});
