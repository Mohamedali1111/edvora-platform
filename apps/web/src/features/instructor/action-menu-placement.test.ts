import assert from "node:assert/strict";
import test from "node:test";
import { computeMenuPlacement } from "./action-menu-placement";

const VIEWPORT = { viewportWidth: 1280, viewportHeight: 800 };

test("opens below the trigger when there is enough space", () => {
  const placement = computeMenuPlacement({
    triggerRect: { top: 100, left: 900, right: 940, bottom: 140 },
    menuWidth: 220,
    menuHeight: 200,
    dir: "ltr",
    ...VIEWPORT,
  });

  // bottom (140) + gap (6)
  assert.equal(placement.top, 146);
});

test("flips above the trigger when there isn't enough room below but there is above", () => {
  const placement = computeMenuPlacement({
    // Trigger near the bottom of an 800px-tall viewport - a 200px menu can't fit below (740 + 6 + 200 > 792).
    triggerRect: { top: 740, left: 900, right: 940, bottom: 780 },
    menuWidth: 220,
    menuHeight: 200,
    dir: "ltr",
    ...VIEWPORT,
  });

  // top (740) - gap (6) - menuHeight (200)
  assert.equal(placement.top, 534);
});

test("clamps to the top margin when the menu fits neither above nor below", () => {
  const placement = computeMenuPlacement({
    triggerRect: { top: 400, left: 900, right: 940, bottom: 440 },
    menuWidth: 220,
    // Taller than the whole viewport.
    menuHeight: 900,
    dir: "ltr",
    ...VIEWPORT,
  });

  assert.equal(placement.top, 8);
});

test("clamps against the right viewport edge in LTR instead of overflowing off-screen", () => {
  const placement = computeMenuPlacement({
    // Trigger sits right at the viewport's right edge.
    triggerRect: { top: 100, left: 1250, right: 1276, bottom: 140 },
    menuWidth: 220,
    menuHeight: 200,
    dir: "ltr",
    ...VIEWPORT,
  });

  // viewportWidth (1280) - margin (8) - menuWidth (220)
  assert.equal(placement.left, 1052);
});

test("clamps against the left viewport edge instead of a negative left offset", () => {
  const placement = computeMenuPlacement({
    // A narrow trigger near the left edge: right - menuWidth would go negative.
    triggerRect: { top: 100, left: 4, right: 44, bottom: 140 },
    menuWidth: 220,
    menuHeight: 200,
    dir: "ltr",
    ...VIEWPORT,
  });

  assert.equal(placement.left, 8);
});

test("RTL anchors the menu to the trigger's left edge (the logical end side), not the right", () => {
  const placement = computeMenuPlacement({
    triggerRect: { top: 100, left: 500, right: 540, bottom: 140 },
    menuWidth: 220,
    menuHeight: 200,
    dir: "rtl",
    ...VIEWPORT,
  });

  assert.equal(placement.left, 500);
});

test("RTL still clamps against the right viewport edge when the end-anchored position would overflow", () => {
  const placement = computeMenuPlacement({
    triggerRect: { top: 100, left: 1200, right: 1240, bottom: 140 },
    menuWidth: 220,
    menuHeight: 200,
    dir: "rtl",
    ...VIEWPORT,
  });

  assert.equal(placement.left, 1052);
});

test("placement is derived only from the viewport-relative trigger rect and viewport size - a page scrolled far down yields the same result as an unscrolled page for the same visible trigger position", () => {
  // getBoundingClientRect() already returns viewport-relative coordinates
  // regardless of scroll position, so a trigger visually at the same spot
  // on screen produces an identical placement whether the document is
  // scrolled 0px or 5000px - there is no document-offset arithmetic to get
  // wrong here.
  const scrolledFarDownButSameViewportPosition = {
    top: 100,
    left: 900,
    right: 940,
    bottom: 140,
  };

  const placement = computeMenuPlacement({
    triggerRect: scrolledFarDownButSameViewportPosition,
    menuWidth: 220,
    menuHeight: 200,
    dir: "ltr",
    ...VIEWPORT,
  });

  assert.equal(placement.top, 146);
  assert.equal(placement.left, 720);
});
