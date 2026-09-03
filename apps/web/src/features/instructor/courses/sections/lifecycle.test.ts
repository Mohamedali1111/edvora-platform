import assert from "node:assert/strict";
import test from "node:test";
import {
  canArchiveSection,
  canEditSectionMetadata,
  canPublishSection,
  canReorderSection,
  canRestoreSection,
  canTakeSectionOffline,
  isSectionArchived,
} from "./lifecycle";

test("DRAFT is editable, publishable, archivable, and reorderable, but not offline-able or restorable", () => {
  assert.equal(canEditSectionMetadata("DRAFT"), true);
  assert.equal(canPublishSection("DRAFT"), true);
  assert.equal(canTakeSectionOffline("DRAFT"), false);
  assert.equal(canArchiveSection("DRAFT"), true);
  assert.equal(canRestoreSection("DRAFT"), false);
  assert.equal(canReorderSection("DRAFT"), true);
  assert.equal(isSectionArchived("DRAFT"), false);
});

test("PUBLISHED is editable, archivable, reorderable, and can be taken offline, but not published again or restored", () => {
  assert.equal(canEditSectionMetadata("PUBLISHED"), true);
  assert.equal(canPublishSection("PUBLISHED"), false);
  assert.equal(canTakeSectionOffline("PUBLISHED"), true);
  assert.equal(canArchiveSection("PUBLISHED"), true);
  assert.equal(canRestoreSection("PUBLISHED"), false);
  assert.equal(canReorderSection("PUBLISHED"), true);
  assert.equal(isSectionArchived("PUBLISHED"), false);
});

test("ARCHIVED is read-only, unreorderable, and only restorable", () => {
  assert.equal(canEditSectionMetadata("ARCHIVED"), false);
  assert.equal(canPublishSection("ARCHIVED"), false);
  assert.equal(canTakeSectionOffline("ARCHIVED"), false);
  assert.equal(canArchiveSection("ARCHIVED"), false);
  assert.equal(canRestoreSection("ARCHIVED"), true);
  assert.equal(canReorderSection("ARCHIVED"), false);
  assert.equal(isSectionArchived("ARCHIVED"), true);
});
