import assert from "node:assert/strict";
import test from "node:test";
import { getDesktopMoreDestinations, getMobileMoreDestinations, moreDestinations } from "./more";

test("desktop More contains only secondary destinations and does not duplicate Progress", () => {
  assert.deepEqual(
    getDesktopMoreDestinations().map((destination) => destination.id),
    ["notifications"],
  );
});

test("mobile More contains Progress plus genuine secondary destinations", () => {
  assert.deepEqual(
    getMobileMoreDestinations().map((destination) => destination.id),
    ["progress", "notifications"],
  );
});

test("More destination model has no duplicate ids or routes", () => {
  assert.equal(new Set(moreDestinations.map((destination) => destination.id)).size, moreDestinations.length);
  assert.equal(new Set(moreDestinations.map((destination) => destination.href)).size, moreDestinations.length);
});
