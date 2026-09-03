"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/lib/i18n/i18n";
import { computeMenuPlacement } from "./action-menu-placement";
import { wrapMenuIndex } from "./action-menu-navigation";

export type ActionMenuItem = {
  key: string;
  label: string;
  onSelect: () => void;
  /** Hidden from the menu entirely rather than shown disabled - use `disabled` instead when the action exists but isn't currently valid. */
  disabled?: boolean;
  /** Shown to sighted users via `title` and to assistive tech via `aria-describedby` when `disabled` is true. */
  disabledReason?: string;
  /** Destructive styling (e.g. Archive) - never used for Restore/Take Offline/Move, which are reversible, ordinary actions. */
  danger?: boolean;
};

/** Matches the `@media (max-width: 640px)` breakpoint in styles/instructor/action-menu.css. */
const MOBILE_BREAKPOINT_QUERY = "(max-width: 640px)";

/**
 * The shared Instructor Web overflow ("...") action menu - the single
 * secondary-actions surface every management row (Course, Section, Lesson,
 * Quiz) uses instead of a wall of equally-weighted buttons.
 *
 * The opened panel is rendered through a React portal into `document.body`
 * and positioned with `position: fixed`, computed from the trigger's
 * `getBoundingClientRect()` (action-menu-placement.ts). This is deliberate,
 * not incidental: an earlier `position: absolute` version anchored inside
 * the row was clipped by `.table-scroll`'s `overflow-x: auto` (which forces
 * a clipping `overflow-y: auto` too, per the CSS overflow spec) for rows
 * near the bottom of the Courses/Quizzes tables. Portaling to `document.body`
 * removes the popover from that container's box entirely, so it can never
 * be clipped by it - without touching `.table-scroll` itself, which Students/
 * Enrollments and other unrelated surfaces also depend on.
 *
 * Positioning is applied *imperatively* to the panel's DOM node (via its
 * ref), not through a React-rendered `style` prop, and deliberately so:
 * placement is only known after the panel has been measured, one paint
 * after `open` first becomes true. Driving that through React state would
 * mean the newly-computed style only lands on the DOM after a second,
 * state-triggered re-render - and this component also needs to move focus
 * into the first menu item on open. Focus cannot land on an element that is
 * still hidden pending that second render, so the panel is instead always
 * rendered focusable (just off-screen, see the initial `-9999px` inline
 * style below) and repositioned on-screen in the same synchronous
 * `useLayoutEffect` pass, strictly before the sibling effect that moves
 * focus runs - no hidden/visible race, no flash, no reliance on effect
 * ordering across renders.
 *
 * Below the mobile breakpoint the panel is still portaled (one rendering
 * path for both shapes), but this component leaves it unpositioned there -
 * styles/instructor/action-menu.css's media query alone turns it into the
 * full-width bottom/action sheet with its own dismiss scrim.
 *
 * Items are real `<button role="menuitem">` elements so Enter/Space activate
 * them natively; ArrowUp/ArrowDown move focus between them (wrapping, see
 * action-menu-navigation.ts). Every *passive* dismissal - Escape, an
 * outside pointerdown, the mobile scrim, a scroll, or a resize - restores
 * focus to the trigger (see the `close()` doc comment below for the full
 * rule and why it isn't keyboard-only). Selecting an item is the one
 * exception: it also refocuses the trigger first, but only so a
 * subsequently-opened dialog has a valid, still-mounted element to treat as
 * "what was focused before" for its own eventual focus-return (see Modal in
 * students/dialog.tsx) - not because the trigger is where focus should end
 * up once that dialog takes over.
 *
 * Tab is the one dismissal that's deliberately *not* just `close(true)`
 * plus a `preventDefault()`: it calls `close(true)` (closes the menu,
 * synchronously refocuses the trigger) and then lets the native, unprevented
 * Tab keypress continue. A browser only computes "next focusable element"
 * for that native continuation *after* all keydown listeners have run, by
 * which point `document.activeElement` is already the trigger - so the same
 * keypress that closes the menu also advances focus to the control after
 * the trigger in the row/table's real tab order, exactly as if the menu had
 * never been there, rather than from wherever the portaled panel happens to
 * sit in `document.body`'s DOM order. Shift+Tab is handled identically (this
 * component never distinguishes the two): closing and refocusing the
 * trigger first is what makes the browser's native reverse traversal
 * correct too.
 *
 * A disabled item stays focusable (`aria-disabled`, not the native
 * `disabled` attribute) specifically so its reason is still reachable by
 * keyboard and screen reader users, not just sighted mouse users hovering a
 * `title`.
 */
export function ActionMenu({ label, items }: { label: string; items: ActionMenuItem[] }) {
  const { t, dir } = useI18n();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  /**
   * Every dismissal path restores focus to the exact trigger that opened
   * the menu, with one deliberate exception: selecting a menu item
   * (`item.onSelect()`), where the action itself may intentionally move
   * focus elsewhere (open a dialog, navigate) - forcing focus back to the
   * trigger there would fight that destination. Every *passive* dismissal -
   * Escape, an outside pointerdown, the mobile scrim, a scroll, or a
   * resize - has not intentionally moved focus anywhere, so all of them
   * restore it here. This isn't only about explicit keyboard/screen-reader
   * users: once the menu closes, its (possibly still-focused) item buttons
   * unmount: with nothing to redirect focus to, the browser silently drops
   * focus to `document.body`, an equally real regression for anyone
   * driving focus at all (an external keyboard on a touch device included) -
   * restoring it here is what avoids that, not a keyboard-only special case.
   * `scroll` alone passes `preventScroll` - `focus()`'s default browser
   * behavior is to scroll the focused element into view, which would fight
   * the very scroll gesture that just closed the menu.
   */
  function close(returnFocus: boolean, focusOptions?: FocusOptions) {
    setOpen(false);
    if (returnFocus) {
      triggerRef.current?.focus(focusOptions);
    }
  }

  useLayoutEffect(() => {
    if (!open) {
      return;
    }

    const trigger = triggerRef.current;
    const panel = panelRef.current;
    const mobileQuery = window.matchMedia(MOBILE_BREAKPOINT_QUERY);

    // Imperative, not a React-rendered style prop - see the component doc
    // comment above for why: this must apply synchronously, in this same
    // pass, before the sibling effect below moves focus into the panel.
    function reposition() {
      if (!trigger || !panel) {
        return;
      }

      if (mobileQuery.matches) {
        // Let the CSS bottom-sheet media query own layout entirely.
        panel.style.removeProperty("top");
        panel.style.removeProperty("left");
        return;
      }

      const placement = computeMenuPlacement({
        triggerRect: trigger.getBoundingClientRect(),
        menuWidth: panel.getBoundingClientRect().width,
        menuHeight: panel.getBoundingClientRect().height,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        dir,
      });

      panel.style.top = `${placement.top}px`;
      panel.style.left = `${placement.left}px`;
    }

    reposition();
    mobileQuery.addEventListener("change", reposition);

    // First item first - matches the standard role="menu" open behavior,
    // and only runs after `reposition()` above has already placed the
    // panel on-screen (or handed it to the mobile sheet CSS), so focus
    // never lands on the still off-screen initial position.
    itemRefs.current[0]?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        close(true);
        return;
      }

      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const direction = event.key === "ArrowDown" ? 1 : -1;
        const currentIndex = itemRefs.current.findIndex((el) => el === document.activeElement);
        const next = wrapMenuIndex(currentIndex, direction, items.length);
        if (next !== -1) {
          itemRefs.current[next]?.focus();
        }
        return;
      }

      if (event.key === "Tab") {
        // Not a focus trap, and deliberately no preventDefault() here - see
        // the component doc comment above for why letting the native Tab
        // continue after this synchronous close+refocus is what makes it
        // land on the correct next/previous control in a single keypress.
        close(true);
      }
    }

    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) {
        return;
      }
      close(true);
    }

    // Capture phase so this fires for a scroll on *any* scrollable
    // ancestor (e.g. `.table-scroll`), not only a bubbling window scroll -
    // scroll events don't bubble, but capturing listeners still see them on
    // the way down to their target regardless. Scrolling *within* the
    // menu's own `overflow-y: auto` item list (a long menu) must not close
    // it, so that case is excluded explicitly.
    function onScroll(event: Event) {
      if (panelRef.current?.contains(event.target as Node)) {
        return;
      }
      close(true, { preventScroll: true });
    }

    function onResize() {
      // Simpler and safer than recalculating mid-open (which would also
      // have to handle a desktop<->mobile mode change): just close, so the
      // next open always computes fresh from the current layout.
      close(true);
    }

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);

    return () => {
      mobileQuery.removeEventListener("change", reposition);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open, dir, items.length]);

  return (
    <div className="action-menu">
      <button
        ref={triggerRef}
        type="button"
        className="action-menu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((value) => !value)}
      >
        <MoreIcon />
      </button>

      {open
        ? createPortal(
            <>
              <button
                type="button"
                className="action-menu-scrim"
                aria-label={t("common.close")}
                tabIndex={-1}
                onClick={() => close(true)}
              />
              <div
                className="action-menu-panel"
                role="menu"
                aria-label={label}
                ref={panelRef}
                // Off-screen but still focusable (unlike visibility:hidden/
                // display:none) until the layout effect above repositions
                // it - see the component doc comment for why this can't be
                // a hidden/visible toggle instead.
                style={{ position: "fixed", top: -9999, left: -9999 }}
              >
                {items.map((item, index) => (
                  <button
                    key={item.key}
                    ref={(el) => {
                      itemRefs.current[index] = el;
                    }}
                    type="button"
                    role="menuitem"
                    className={`action-menu-item${item.danger ? " action-menu-item-danger" : ""}`}
                    aria-disabled={item.disabled ? "true" : undefined}
                    aria-describedby={item.disabled && item.disabledReason ? `${item.key}-disabled-reason` : undefined}
                    title={item.disabled ? item.disabledReason : undefined}
                    onClick={() => {
                      if (item.disabled) {
                        return;
                      }
                      close(true);
                      item.onSelect();
                    }}
                  >
                    {item.label}
                    {item.disabled && item.disabledReason ? (
                      <span className="sr-only" id={`${item.key}-disabled-reason`}>
                        {item.disabledReason}
                      </span>
                    ) : null}
                  </button>
                ))}
              </div>
            </>,
            document.body,
          )
        : null}
    </div>
  );
}

/** Three-dot "more" glyph - symmetric, so it never mirrors in RTL (docs/UI-GUIDELINES.md: only direction-carrying icons mirror). */
function MoreIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <circle cx="10" cy="4.5" r="1.6" />
      <circle cx="10" cy="10" r="1.6" />
      <circle cx="10" cy="15.5" r="1.6" />
    </svg>
  );
}
