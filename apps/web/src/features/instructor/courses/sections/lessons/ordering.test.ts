import assert from "node:assert/strict";
import test from "node:test";
import type { LessonSummary } from "../../../../../lib/api/types";
import { moveEarlier, moveLater, reorderableLessonIds } from "./ordering";

function lesson(lessonId: string, status: LessonSummary["status"], position: number): LessonSummary {
  return {
    lessonId,
    tenantId: "tenant-1",
    courseId: "course-1",
    sectionId: "section-1",
    title: `Lesson ${lessonId}`,
    description: null,
    type: "VIDEO",
    position,
    status,
    availableFrom: null,
    availableUntil: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    videoAssetId: "asset-1",
    documentAssetId: null,
    quizId: null,
  };
}

test("reorderableLessonIds excludes ARCHIVED lessons even when interleaved among active ones", () => {
  const lessons = [lesson("a", "DRAFT", 1), lesson("b", "ARCHIVED", 2), lesson("c", "PUBLISHED", 3)];
  assert.deepEqual(reorderableLessonIds(lessons), ["a", "c"]);
});

test("re-exports the shared move helpers (already fully boundary-tested in sections/ordering.test.ts) rather than redefining them", () => {
  assert.deepEqual(moveEarlier(["a", "b", "c"], "b"), ["b", "a", "c"]);
  assert.deepEqual(moveLater(["a", "b", "c"], "b"), ["a", "c", "b"]);
  assert.equal(moveEarlier(["a", "b", "c"], "a"), null);
  assert.equal(moveLater(["a", "b", "c"], "c"), null);
});
