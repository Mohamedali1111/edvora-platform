import assert from "node:assert/strict";
import test from "node:test";
import {
  canArchiveQuiz,
  canCreateQuestion,
  canEditQuiz,
  canMutateOption,
  canMutateQuestion,
  canPublishQuiz,
  canReorderQuestion,
  canRestoreQuiz,
  canTakeQuizOffline,
  isQuizArchived,
} from "./lifecycle";

test("DRAFT quizzes are editable, publishable, archivable, and allow incremental question/option authoring", () => {
  assert.equal(canEditQuiz("DRAFT"), true);
  assert.equal(canPublishQuiz("DRAFT"), true);
  assert.equal(canTakeQuizOffline("DRAFT"), false);
  assert.equal(canArchiveQuiz("DRAFT"), true);
  assert.equal(canRestoreQuiz("DRAFT"), false);
  assert.equal(canCreateQuestion("DRAFT"), true);
  assert.equal(canMutateQuestion("DRAFT", "ACTIVE"), true);
  assert.equal(canMutateOption("DRAFT", "ACTIVE"), true);
});

test("PUBLISHED quizzes can edit existing active aggregate pieces, can be taken offline, but cannot create new questions or be restored", () => {
  assert.equal(canEditQuiz("PUBLISHED"), true);
  assert.equal(canPublishQuiz("PUBLISHED"), false);
  assert.equal(canTakeQuizOffline("PUBLISHED"), true);
  assert.equal(canArchiveQuiz("PUBLISHED"), true);
  assert.equal(canRestoreQuiz("PUBLISHED"), false);
  assert.equal(canCreateQuestion("PUBLISHED"), false);
  assert.equal(canMutateQuestion("PUBLISHED", "ACTIVE"), true);
  assert.equal(canReorderQuestion("PUBLISHED", "ACTIVE"), true);
});

test("ARCHIVED quizzes are read-only and only restorable - question/option authoring controls stay read-only", () => {
  assert.equal(canEditQuiz("ARCHIVED"), false);
  assert.equal(canPublishQuiz("ARCHIVED"), false);
  assert.equal(canTakeQuizOffline("ARCHIVED"), false);
  assert.equal(canArchiveQuiz("ARCHIVED"), false);
  assert.equal(canRestoreQuiz("ARCHIVED"), true);
  assert.equal(isQuizArchived("ARCHIVED"), true);
  assert.equal(canCreateQuestion("ARCHIVED"), false);
  assert.equal(canMutateQuestion("ARCHIVED", "ACTIVE"), false);
  assert.equal(canMutateOption("ARCHIVED", "ACTIVE"), false);
});

test("archived questions are excluded from metadata edits, option edits, and reorder controls", () => {
  assert.equal(canMutateQuestion("DRAFT", "ARCHIVED"), false);
  assert.equal(canMutateOption("PUBLISHED", "ARCHIVED"), false);
  assert.equal(canReorderQuestion("DRAFT", "ARCHIVED"), false);
});
