import assert from "node:assert/strict";
import test from "node:test";
import { canGoNext, canGoPrevious, nextOffset, previousOffset } from "./pagination";

test("advances to the next page by exactly one page size", () => {
  assert.equal(nextOffset(0, 20), 20);
  assert.equal(nextOffset(20, 20), 40);
});

test("next-page availability is driven exclusively by hasMore, never a computed total", () => {
  assert.equal(canGoNext(true), true);
  assert.equal(canGoNext(false), false);
});

test("moves back exactly one page size and never goes negative", () => {
  assert.equal(previousOffset(40, 20), 20);
  assert.equal(previousOffset(20, 20), 0);
  assert.equal(previousOffset(10, 20), 0); // would go negative - clamps to 0
  assert.equal(previousOffset(0, 20), 0);
});

test("previous-page availability is driven exclusively by offset > 0", () => {
  assert.equal(canGoPrevious(0), false);
  assert.equal(canGoPrevious(1), true);
  assert.equal(canGoPrevious(20), true);
});
