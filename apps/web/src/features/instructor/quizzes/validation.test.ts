import assert from "node:assert/strict";
import test from "node:test";
import { buildOptionCreatePayload, buildOptionUpdatePayload, buildQuestionCreatePayload, buildQuizCreatePayload, buildQuizUpdatePayload, parseDecimalInput } from "./validation";

test("quiz create payload trims text and sends exact nullable metadata semantics", () => {
  const result = buildQuizCreatePayload({
    title: "  Algebra quiz  ",
    description: "   ",
    passingScorePercent: "82.50",
    attemptLimit: "",
    revealAnswersPolicy: "AFTER_PASSING",
  });

  assert.deepEqual(result.errors, {});
  assert.deepEqual(result.payload, {
    title: "Algebra quiz",
    description: null,
    passingScorePercent: 82.5,
    attemptLimit: null,
    revealAnswersPolicy: "AFTER_PASSING",
  });
});

test("quiz update payload preserves explicit clear values instead of omitting them", () => {
  const result = buildQuizUpdatePayload({
    title: "Quiz",
    description: "",
    passingScorePercent: "",
    attemptLimit: "",
    revealAnswersPolicy: "NEVER",
  });

  assert.deepEqual(result.payload, {
    title: "Quiz",
    description: null,
    passingScorePercent: null,
    attemptLimit: null,
    revealAnswersPolicy: "NEVER",
  });
});

test("decimal helpers reject silent rounding and out-of-range values", () => {
  assert.deepEqual(parseDecimalInput("50.123", { required: false, min: 0, max: 100 }), { error: "invalid" });
  assert.deepEqual(parseDecimalInput("101", { required: false, min: 0, max: 100 }), { error: "tooLarge" });
});

test("question payloads use only supported type, prompt, and points fields", () => {
  const result = buildQuestionCreatePayload({ type: "TRUE_FALSE", prompt: "  Answer? ", points: "1.25" });

  assert.deepEqual(result.errors, {});
  assert.deepEqual(result.payload, { type: "TRUE_FALSE", prompt: "Answer?", points: 1.25 });
});

test("option payloads trim label/text and keep correctness as the single backend boolean", () => {
  assert.deepEqual(buildOptionCreatePayload({ label: " A ", text: " Choice A ", isCorrect: true }).payload, {
    label: "A",
    text: "Choice A",
    isCorrect: true,
  });
  assert.deepEqual(buildOptionUpdatePayload({ label: " ", text: " Revised " }).payload, { label: null, text: "Revised" });
});
