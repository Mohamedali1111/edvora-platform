import assert from "node:assert/strict";
import test from "node:test";
import {
  canArchiveLesson,
  canEditLessonMetadata,
  canPublishLesson,
  canReorderLesson,
  canRestoreLesson,
  canTakeLessonOffline,
  isLessonArchived,
} from "./lifecycle";

test("DRAFT is editable, publishable, archivable, and reorderable, but not offline-able or restorable", () => {
  assert.equal(canEditLessonMetadata("DRAFT"), true);
  assert.equal(canPublishLesson("DRAFT"), true);
  assert.equal(canTakeLessonOffline("DRAFT"), false);
  assert.equal(canArchiveLesson("DRAFT"), true);
  assert.equal(canRestoreLesson("DRAFT"), false);
  assert.equal(canReorderLesson("DRAFT"), true);
  assert.equal(isLessonArchived("DRAFT"), false);
});

test("PUBLISHED is editable, archivable, reorderable, and can be taken offline, but not published again or restored", () => {
  assert.equal(canEditLessonMetadata("PUBLISHED"), true);
  assert.equal(canPublishLesson("PUBLISHED"), false);
  assert.equal(canTakeLessonOffline("PUBLISHED"), true);
  assert.equal(canArchiveLesson("PUBLISHED"), true);
  assert.equal(canRestoreLesson("PUBLISHED"), false);
  assert.equal(canReorderLesson("PUBLISHED"), true);
  assert.equal(isLessonArchived("PUBLISHED"), false);
});

test("ARCHIVED is read-only, unreorderable, and only restorable", () => {
  assert.equal(canEditLessonMetadata("ARCHIVED"), false);
  assert.equal(canPublishLesson("ARCHIVED"), false);
  assert.equal(canTakeLessonOffline("ARCHIVED"), false);
  assert.equal(canArchiveLesson("ARCHIVED"), false);
  assert.equal(canRestoreLesson("ARCHIVED"), true);
  assert.equal(canReorderLesson("ARCHIVED"), false);
  assert.equal(isLessonArchived("ARCHIVED"), true);
});
