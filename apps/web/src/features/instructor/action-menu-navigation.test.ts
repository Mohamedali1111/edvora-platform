import assert from "node:assert/strict";
import test from "node:test";
import { wrapMenuIndex } from "./action-menu-navigation";

test("ArrowDown moves to the next item and wraps from the last item back to the first", () => {
  assert.equal(wrapMenuIndex(0, 1, 4), 1);
  assert.equal(wrapMenuIndex(2, 1, 4), 3);
  assert.equal(wrapMenuIndex(3, 1, 4), 0);
});

test("ArrowUp moves to the previous item and wraps from the first item back to the last", () => {
  assert.equal(wrapMenuIndex(2, -1, 4), 1);
  assert.equal(wrapMenuIndex(0, -1, 4), 3);
});

test("starting from -1 (nothing focused yet), ArrowDown lands on the first item and ArrowUp lands on the last", () => {
  assert.equal(wrapMenuIndex(-1, 1, 3), 0);
  assert.equal(wrapMenuIndex(-1, -1, 3), 2);
});

test("an empty menu has no valid index in either direction", () => {
  assert.equal(wrapMenuIndex(0, 1, 0), -1);
  assert.equal(wrapMenuIndex(0, -1, 0), -1);
});

test("a single-item menu always wraps back to itself", () => {
  assert.equal(wrapMenuIndex(0, 1, 1), 0);
  assert.equal(wrapMenuIndex(0, -1, 1), 0);
});
