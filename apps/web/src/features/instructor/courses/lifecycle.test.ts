import assert from "node:assert/strict";
import test from "node:test";
import {
  canArchive,
  canEditCourseMetadata,
  canPublish,
  canPublishAgainFromCoursesList,
  canRestore,
  canTakeOffline,
  isArchived,
} from "./lifecycle";

test("DRAFT is editable, publishable, and archivable, but not offline-able or restorable", () => {
  assert.equal(canEditCourseMetadata("DRAFT"), true);
  assert.equal(canPublish("DRAFT"), true);
  assert.equal(canTakeOffline("DRAFT"), false);
  assert.equal(canArchive("DRAFT"), true);
  assert.equal(canRestore("DRAFT"), false);
  assert.equal(isArchived("DRAFT"), false);
});

test("PUBLISHED is editable, archivable, and can be taken offline, but not offered as a publish target again or restored", () => {
  assert.equal(canEditCourseMetadata("PUBLISHED"), true);
  assert.equal(canPublish("PUBLISHED"), false);
  assert.equal(canTakeOffline("PUBLISHED"), true);
  assert.equal(canArchive("PUBLISHED"), true);
  assert.equal(canRestore("PUBLISHED"), false);
  assert.equal(isArchived("PUBLISHED"), false);
});

test("ARCHIVED is read-only and only restorable - not editable, publishable, offline-able, or archivable again", () => {
  assert.equal(canEditCourseMetadata("ARCHIVED"), false);
  assert.equal(canPublish("ARCHIVED"), false);
  assert.equal(canTakeOffline("ARCHIVED"), false);
  assert.equal(canArchive("ARCHIVED"), false);
  assert.equal(canRestore("ARCHIVED"), true);
  assert.equal(isArchived("ARCHIVED"), true);
});

test("the Courses list only offers 'Make live again' for a Draft Course that has been live before", () => {
  assert.equal(canPublishAgainFromCoursesList({ status: "DRAFT", publishedAt: null }), false);
  assert.equal(canPublishAgainFromCoursesList({ status: "DRAFT", publishedAt: "2026-08-01T00:00:00.000Z" }), true);
  assert.equal(canPublishAgainFromCoursesList({ status: "PUBLISHED", publishedAt: "2026-08-01T00:00:00.000Z" }), false);
  assert.equal(canPublishAgainFromCoursesList({ status: "ARCHIVED", publishedAt: "2026-08-01T00:00:00.000Z" }), false);
});
