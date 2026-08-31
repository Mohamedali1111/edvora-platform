import assert from "node:assert/strict";
import test from "node:test";
import type { CourseSectionSummary } from "../../../../lib/api/types";
import { moveEarlier, moveLater, reorderableSectionIds } from "./ordering";

function section(sectionId: string, status: CourseSectionSummary["status"], position: number): CourseSectionSummary {
  return {
    sectionId,
    tenantId: "tenant-1",
    courseId: "course-1",
    title: `Section ${sectionId}`,
    description: null,
    position,
    status,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };
}

test("reorderableSectionIds excludes ARCHIVED sections even when interleaved among active ones", () => {
  const sections = [section("a", "DRAFT", 1), section("b", "ARCHIVED", 2), section("c", "PUBLISHED", 3)];
  assert.deepEqual(reorderableSectionIds(sections), ["a", "c"]);
});

test("moveEarlier swaps a section with the one immediately before it in the reorderable order", () => {
  assert.deepEqual(moveEarlier(["a", "b", "c"], "b"), ["b", "a", "c"]);
  assert.deepEqual(moveEarlier(["a", "b", "c"], "c"), ["a", "c", "b"]);
});

test("moveEarlier returns null for the first section - cannot move the first section earlier", () => {
  assert.equal(moveEarlier(["a", "b", "c"], "a"), null);
});

test("moveEarlier returns null for a section id not present in the order", () => {
  assert.equal(moveEarlier(["a", "b", "c"], "z"), null);
});

test("moveLater swaps a section with the one immediately after it in the reorderable order", () => {
  assert.deepEqual(moveLater(["a", "b", "c"], "a"), ["b", "a", "c"]);
  assert.deepEqual(moveLater(["a", "b", "c"], "b"), ["a", "c", "b"]);
});

test("moveLater returns null for the last section - cannot move the last section later", () => {
  assert.equal(moveLater(["a", "b", "c"], "c"), null);
});

test("moveLater returns null for a section id not present in the order", () => {
  assert.equal(moveLater(["a", "b", "c"], "z"), null);
});

test("move helpers never mutate the input array", () => {
  const order = ["a", "b", "c"];
  moveEarlier(order, "b");
  moveLater(order, "b");
  assert.deepEqual(order, ["a", "b", "c"]);
});

test("a single-section order can move neither earlier nor later", () => {
  assert.equal(moveEarlier(["only"], "only"), null);
  assert.equal(moveLater(["only"], "only"), null);
});
