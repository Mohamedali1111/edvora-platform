import assert from "node:assert/strict";
import test from "node:test";
import { formatDateTime } from "./format";

test("formats a valid ISO timestamp as a non-empty locale string, not the raw ISO text", () => {
  const result = formatDateTime("2026-08-31T09:00:00.000Z");
  assert.notEqual(result, "");
  assert.notEqual(result, "2026-08-31T09:00:00.000Z");
});

test("returns the raw string unchanged if it can't be parsed, rather than throwing or fabricating a date", () => {
  assert.equal(formatDateTime("not-a-date"), "not-a-date");
});
