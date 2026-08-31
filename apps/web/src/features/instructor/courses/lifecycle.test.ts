import assert from "node:assert/strict";
import test from "node:test";
import { canArchive, canEditCourseMetadata, canPublish, isTerminal } from "./lifecycle";

test("DRAFT is editable, publishable, and archivable", () => {
  assert.equal(canEditCourseMetadata("DRAFT"), true);
  assert.equal(canPublish("DRAFT"), true);
  assert.equal(canArchive("DRAFT"), true);
  assert.equal(isTerminal("DRAFT"), false);
});

test("PUBLISHED is editable and archivable, but not offered as a publish target again", () => {
  assert.equal(canEditCourseMetadata("PUBLISHED"), true);
  assert.equal(canPublish("PUBLISHED"), false);
  assert.equal(canArchive("PUBLISHED"), true);
  assert.equal(isTerminal("PUBLISHED"), false);
});

test("ARCHIVED is terminal and fully read-only: not editable, not publishable, not archivable", () => {
  assert.equal(canEditCourseMetadata("ARCHIVED"), false);
  assert.equal(canPublish("ARCHIVED"), false);
  assert.equal(canArchive("ARCHIVED"), false);
  assert.equal(isTerminal("ARCHIVED"), true);
});
