/**
 * Pure viewport placement math for the portaled `ActionMenu` popover
 * (action-menu.tsx), kept separate so it's unit-testable without a DOM -
 * this project's test runner only compiles and executes plain `.ts` files,
 * not `.tsx` components (see action-menu-navigation.ts's header comment for
 * the same note).
 *
 * The menu is rendered via `createPortal` into `document.body` and
 * positioned with `position: fixed`, so every rect here is expected to
 * already be viewport-relative - exactly what `Element.getBoundingClientRect()`
 * returns, and exactly what `position: fixed` consumes. Nothing in this
 * module adds `window.scrollX`/`scrollY`, and it deliberately never needs
 * to: a `fixed`-positioned box's offsets are relative to the viewport
 * regardless of how far the page (or any ancestor, including the
 * horizontally-scrolling `.table-scroll` a Courses/Quizzes row's trigger
 * may sit inside) has scrolled. That's what makes `position: fixed` (versus
 * the previous `position: absolute` anchored inside the row) immune to the
 * `.table-scroll` clipping bug: the popover is no longer a descendant of
 * any scrolling/clipping container's box at all.
 */
export type ViewportRect = {
  top: number;
  left: number;
  right: number;
  bottom: number;
};

export type MenuPlacement = {
  top: number;
  left: number;
};

const DEFAULT_GAP = 6;
const DEFAULT_MARGIN = 8;

/**
 * Where to place the menu panel so it (a) prefers opening below the
 * trigger, flipping above only when below doesn't fit but above does, and
 * (b) never extends past any viewport edge - clamped on both axes as a
 * final step so even a menu taller/wider than the available space still
 * renders fully on-screen (relying on the panel's own `max-height` +
 * `overflow-y: auto` for the pathological case where it's taller than the
 * viewport itself).
 */
export function computeMenuPlacement(params: {
  triggerRect: ViewportRect;
  menuWidth: number;
  menuHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  dir: "ltr" | "rtl";
  gap?: number;
  margin?: number;
}): MenuPlacement {
  const { triggerRect, menuWidth, menuHeight, viewportWidth, viewportHeight, dir } = params;
  const gap = params.gap ?? DEFAULT_GAP;
  const margin = params.margin ?? DEFAULT_MARGIN;

  const opensBelowFits = triggerRect.bottom + gap + menuHeight <= viewportHeight - margin;
  const opensAboveFits = triggerRect.top - gap - menuHeight >= margin;

  // Prefer below; flip above only when below doesn't fit but above does.
  // If neither fits (the menu is taller than the viewport has room for in
  // either direction), fall through to "below" - the clamp below still
  // guarantees the result stays on-screen.
  let top = opensBelowFits || !opensAboveFits ? triggerRect.bottom + gap : triggerRect.top - gap - menuHeight;
  top = clamp(top, margin, Math.max(margin, viewportHeight - margin - menuHeight));

  // End-anchored by default (matches the previous CSS-only `inset-inline-end: 0`
  // anchor): in LTR that's the trigger's right edge, in RTL its left edge.
  const preferredLeft = dir === "rtl" ? triggerRect.left : triggerRect.right - menuWidth;
  const left = clamp(preferredLeft, margin, Math.max(margin, viewportWidth - margin - menuWidth));

  return { top, left };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
