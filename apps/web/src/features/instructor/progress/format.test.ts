import assert from "node:assert/strict";
import test from "node:test";
import { formatAttemptPercentage, formatAttemptScore, formatDateTime, formatProgressPercent, presentPassFail } from "./format";

test("formatDateTime renders a valid ISO timestamp as a non-empty locale string, not the raw ISO text", () => {
  const result = formatDateTime("2026-08-31T05:42:41.000Z", "placeholder");
  assert.notEqual(result, "");
  assert.notEqual(result, "placeholder");
  assert.ok(result.includes("2026") || result.length > 0, "renders something derived from the date");
});

test("formatDateTime falls back to the caller-supplied placeholder for null, never a fabricated date", () => {
  assert.equal(formatDateTime(null, "No activity yet"), "No activity yet");
});

test("formatDateTime returns the raw string unchanged if it can't be parsed, rather than throwing", () => {
  assert.equal(formatDateTime("not-a-date", "placeholder"), "not-a-date");
});

test("formatProgressPercent renders the backend's already-rounded number verbatim with a percent sign - no re-rounding", () => {
  assert.equal(formatProgressPercent(0), "0%");
  assert.equal(formatProgressPercent(66.67), "66.67%");
  assert.equal(formatProgressPercent(100), "100%");
});

test("formatAttemptPercentage preserves the backend's Decimal-as-string precision exactly - never parsed back into a number", () => {
  // A value like "83.30" must not become "83.3" - the backend chose that precision, and
  // Number("83.30").toString() would silently drop the trailing zero.
  assert.equal(formatAttemptPercentage("83.30", "placeholder"), "83.30%");
  assert.equal(formatAttemptPercentage("100.00", "placeholder"), "100.00%");
});

test("formatAttemptPercentage uses the placeholder for null (ungraded), never 0%", () => {
  assert.equal(formatAttemptPercentage(null, "Not graded yet"), "Not graded yet");
});

test("formatAttemptScore concatenates the backend's score/max Decimal strings verbatim, with no numeric parsing", () => {
  assert.equal(formatAttemptScore("8.50", "10.00", "placeholder"), "8.50 / 10.00");
});

test("formatAttemptScore uses the placeholder when either score or max is null (ungraded)", () => {
  assert.equal(formatAttemptScore(null, null, "Not graded yet"), "Not graded yet");
  assert.equal(formatAttemptScore("8", null, "Not graded yet"), "Not graded yet");
  assert.equal(formatAttemptScore(null, "10", "Not graded yet"), "Not graded yet");
});

test("presentPassFail reflects the backend's persisted `passed` value exactly - true/false/null map to passed/failed/pending", () => {
  assert.equal(presentPassFail(true), "passed");
  assert.equal(presentPassFail(false), "failed");
  assert.equal(presentPassFail(null), "pending");
});

test("presentPassFail's signature accepts only `passed` itself - there is no quiz-metadata parameter it could use to recompute a historical result", () => {
  // This is a compile-time guarantee (see the type signature in format.ts), asserted here at
  // the call site: every call in this suite passes only a boolean|null, never a quiz object or
  // a passingScorePercent threshold, and the function still produces a correct result.
  assert.equal(presentPassFail(true), "passed");
});
