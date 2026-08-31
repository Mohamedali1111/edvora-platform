import assert from "node:assert/strict";
import test from "node:test";
import { canArchiveSection, canEditSectionMetadata, canPublishSection, canReorderSection, isSectionTerminal } from "./lifecycle";

test("DRAFT is editable, publishable, archivable, and reorderable", () => {
  assert.equal(canEditSectionMetadata("DRAFT"), true);
  assert.equal(canPublishSection("DRAFT"), true);
  assert.equal(canArchiveSection("DRAFT"), true);
  assert.equal(canReorderSection("DRAFT"), true);
  assert.equal(isSectionTerminal("DRAFT"), false);
});

test("PUBLISHED is editable, archivable, and reorderable, but not offered as a publish target again", () => {
  assert.equal(canEditSectionMetadata("PUBLISHED"), true);
  assert.equal(canPublishSection("PUBLISHED"), false);
  assert.equal(canArchiveSection("PUBLISHED"), true);
  assert.equal(canReorderSection("PUBLISHED"), true);
  assert.equal(isSectionTerminal("PUBLISHED"), false);
});

test("ARCHIVED is terminal and fully read-only: not editable, not publishable, not archivable, excluded from reorder", () => {
  assert.equal(canEditSectionMetadata("ARCHIVED"), false);
  assert.equal(canPublishSection("ARCHIVED"), false);
  assert.equal(canArchiveSection("ARCHIVED"), false);
  assert.equal(canReorderSection("ARCHIVED"), false);
  assert.equal(isSectionTerminal("ARCHIVED"), true);
});
