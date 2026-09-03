import assert from "node:assert/strict";
import test from "node:test";
import { isFirstPublishEligible, resolveCourseHeaderPrimaryAction } from "./first-publish";

test("a never-published Draft Course offers Review & publish, not the plain publish flow", () => {
  assert.equal(resolveCourseHeaderPrimaryAction({ status: "DRAFT", publishedAt: null }), "reviewAndPublish");
  assert.equal(isFirstPublishEligible({ status: "DRAFT", publishedAt: null }), true);
});

test("a previously-published Draft Course offers Make live again, not first-publish review", () => {
  assert.equal(resolveCourseHeaderPrimaryAction({ status: "DRAFT", publishedAt: "2026-08-01T00:00:00.000Z" }), "makeLiveAgain");
  assert.equal(isFirstPublishEligible({ status: "DRAFT", publishedAt: "2026-08-01T00:00:00.000Z" }), false);
});

test("a Live Course exposes no first-publish flow and no big header primary action", () => {
  assert.equal(resolveCourseHeaderPrimaryAction({ status: "PUBLISHED", publishedAt: "2026-08-01T00:00:00.000Z" }), "none");
  assert.equal(isFirstPublishEligible({ status: "PUBLISHED", publishedAt: "2026-08-01T00:00:00.000Z" }), false);
});

test("an Archived Course offers Restore regardless of publish history", () => {
  assert.equal(resolveCourseHeaderPrimaryAction({ status: "ARCHIVED", publishedAt: null }), "restore");
  assert.equal(resolveCourseHeaderPrimaryAction({ status: "ARCHIVED", publishedAt: "2026-08-01T00:00:00.000Z" }), "restore");
  assert.equal(isFirstPublishEligible({ status: "ARCHIVED", publishedAt: "2026-08-01T00:00:00.000Z" }), false);
});
