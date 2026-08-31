import assert from "node:assert/strict";
import test from "node:test";
import { canArchiveLesson, canEditLessonMetadata, canPublishLesson, canReorderLesson, isLessonTerminal } from "./lifecycle";

test("DRAFT is editable, publishable, archivable, and reorderable", () => {
  assert.equal(canEditLessonMetadata("DRAFT"), true);
  assert.equal(canPublishLesson("DRAFT"), true);
  assert.equal(canArchiveLesson("DRAFT"), true);
  assert.equal(canReorderLesson("DRAFT"), true);
  assert.equal(isLessonTerminal("DRAFT"), false);
});

test("PUBLISHED is editable, archivable, and reorderable, but not offered as a publish target again", () => {
  assert.equal(canEditLessonMetadata("PUBLISHED"), true);
  assert.equal(canPublishLesson("PUBLISHED"), false);
  assert.equal(canArchiveLesson("PUBLISHED"), true);
  assert.equal(canReorderLesson("PUBLISHED"), true);
  assert.equal(isLessonTerminal("PUBLISHED"), false);
});

test("ARCHIVED is terminal and fully read-only: not editable, not publishable, not archivable, excluded from reorder", () => {
  assert.equal(canEditLessonMetadata("ARCHIVED"), false);
  assert.equal(canPublishLesson("ARCHIVED"), false);
  assert.equal(canArchiveLesson("ARCHIVED"), false);
  assert.equal(canReorderLesson("ARCHIVED"), false);
  assert.equal(isLessonTerminal("ARCHIVED"), true);
});
