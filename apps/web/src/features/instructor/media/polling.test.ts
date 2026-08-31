import assert from "node:assert/strict";
import test from "node:test";
import { shouldPollVideos } from "./polling";

test("polls while at least one visible video is still UPLOADING or PROCESSING", () => {
  assert.equal(shouldPollVideos([{ processingStatus: "UPLOADING" }]), true);
  assert.equal(shouldPollVideos([{ processingStatus: "PROCESSING" }]), true);
  assert.equal(shouldPollVideos([{ processingStatus: "READY" }, { processingStatus: "PROCESSING" }]), true);
});

test("does not poll once every visible video has reached a terminal state", () => {
  assert.equal(shouldPollVideos([{ processingStatus: "READY" }]), false);
  assert.equal(shouldPollVideos([{ processingStatus: "FAILED" }]), false);
  assert.equal(shouldPollVideos([{ processingStatus: "ARCHIVED" }]), false);
  assert.equal(shouldPollVideos([]), false);
});
