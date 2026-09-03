import assert from "node:assert/strict";
import test from "node:test";
import type { CourseProgressRow } from "@/lib/api/types";
import { resolveCourseProgressSignal, resolveProgressEmptyMessage } from "./progress-view-model";

function progressRow(overrides: Partial<CourseProgressRow>): CourseProgressRow {
  return {
    enrollmentId: "enrollment-1",
    status: "ACTIVE",
    currentlyEffective: true,
    startsAt: null,
    endsAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    student: {
      studentUserId: "student-1",
      email: "student@example.test",
      displayName: null,
      accountStatus: "ACTIVE",
    },
    completedLessons: 0,
    totalLessons: 4,
    progressPercent: 0,
    lastActivityAt: null,
    ...overrides,
  };
}

test("maps Progress empty states to product copy keys", () => {
  assert.equal(resolveProgressEmptyMessage("noCourse"), "progress.noCourseSelected");
  assert.equal(resolveProgressEmptyMessage("noQuiz"), "progress.noQuizSelected");
  assert.equal(resolveProgressEmptyMessage("courseRows"), "progress.empty");
  assert.equal(resolveProgressEmptyMessage("courseRowsFiltered"), "progress.emptyFiltered");
  assert.equal(resolveProgressEmptyMessage("quizAttempts"), "progress.resultsEmpty");
  assert.equal(resolveProgressEmptyMessage("quizAttemptsFiltered"), "progress.resultsEmptyFiltered");
});

test("derives course progress signals only from returned progress fields", () => {
  assert.equal(resolveCourseProgressSignal(progressRow({ totalLessons: 0 })).id, "no-lessons");
  assert.equal(resolveCourseProgressSignal(progressRow({ progressPercent: 100, completedLessons: 4, lastActivityAt: "2026-01-02T00:00:00.000Z" })).id, "complete");
  assert.equal(resolveCourseProgressSignal(progressRow({ progressPercent: 25, lastActivityAt: null })).id, "no-activity");
  assert.equal(resolveCourseProgressSignal(progressRow({ progressPercent: 25, lastActivityAt: "2026-01-02T00:00:00.000Z" })).id, "in-progress");
});
