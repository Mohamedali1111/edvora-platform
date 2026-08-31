import assert from "node:assert/strict";
import test from "node:test";
import type { QuestionSummary } from "@/lib/api/types";
import { moveEarlier, moveLater, reorderableQuestionIds } from "./ordering";

const QUESTIONS: QuestionSummary[] = [
  question("q1", "ACTIVE"),
  question("q2", "ARCHIVED"),
  question("q3", "ACTIVE"),
];

test("reorderableQuestionIds uses only active questions on non-archived quizzes", () => {
  assert.deepEqual(reorderableQuestionIds("DRAFT", QUESTIONS), ["q1", "q3"]);
  assert.deepEqual(reorderableQuestionIds("PUBLISHED", QUESTIONS), ["q1", "q3"]);
});

test("reorderableQuestionIds returns no child authoring IDs when the parent quiz is archived", () => {
  assert.deepEqual(reorderableQuestionIds("ARCHIVED", QUESTIONS), []);
});

test("move helpers swap only one adjacent position and never mutate the input", () => {
  const order = ["a", "b", "c"];
  assert.deepEqual(moveEarlier(order, "b"), ["b", "a", "c"]);
  assert.deepEqual(moveLater(order, "b"), ["a", "c", "b"]);
  assert.deepEqual(order, ["a", "b", "c"]);
});

test("move helpers return null for no-op boundaries or missing IDs", () => {
  assert.equal(moveEarlier(["a"], "a"), null);
  assert.equal(moveLater(["a"], "a"), null);
  assert.equal(moveEarlier(["a"], "missing"), null);
  assert.equal(moveLater(["a"], "missing"), null);
});

function question(questionId: string, status: QuestionSummary["status"]): QuestionSummary {
  return {
    questionId,
    quizId: "quiz",
    type: "MULTIPLE_CHOICE",
    prompt: "Prompt",
    position: 1,
    points: "1",
    status,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}
