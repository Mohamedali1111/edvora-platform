import assert from "node:assert/strict";
import test from "node:test";
import { fromDateTimeLocalValue, toDateTimeLocalValue } from "./format";

test("round-trips a full UTC instant through the datetime-local input value without losing time-of-day", () => {
  // A timestamp whose UTC minute is deliberately not :00 - a date-only
  // input (or a helper that only reads the date portion) would silently
  // collapse this back to midnight.
  const stored = "2026-09-01T14:37:00.000Z";
  const inputValue = toDateTimeLocalValue(stored);

  // The input value is expressed in the local time zone; converting it back
  // through `fromDateTimeLocalValue` must reproduce the same instant,
  // regardless of which time zone the test runs in.
  assert.equal(fromDateTimeLocalValue(inputValue), stored);
});

test("empty input clears availability (maps to null, matching the PATCH contract's explicit-null clear)", () => {
  assert.equal(fromDateTimeLocalValue(""), null);
});

test("null/absent stored value renders as an empty input", () => {
  assert.equal(toDateTimeLocalValue(null), "");
});

test("an unparsable stored value degrades to an empty input instead of throwing", () => {
  assert.equal(toDateTimeLocalValue("not-a-date"), "");
});
