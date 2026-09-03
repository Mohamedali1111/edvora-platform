/**
 * Pure keyboard-navigation math for `ActionMenu` (action-menu.tsx), kept
 * separate from the component so it can be unit-tested without a DOM -
 * this project's test runner (see AGENTS.md/package.json `test` script)
 * only compiles and executes plain `.ts` files, not `.tsx` components, so
 * any React-rendering/keyboard-event behavior itself is covered by the
 * manual QA checklist instead (see the task report), not an automated test.
 *
 * ArrowDown/ArrowUp move focus to the next or previous menu item and wrap
 * around at either end - matching the standard `role="menu"` keyboard
 * pattern. Disabled items are still valid stops (they use `aria-disabled`,
 * not the native `disabled` attribute, precisely so they stay focusable and
 * their reason can be announced - see action-menu.tsx), so this never needs
 * to skip an index; it only needs to know how many items exist.
 */
export function wrapMenuIndex(current: number, direction: 1 | -1, itemCount: number): number {
  if (itemCount <= 0) {
    return -1;
  }

  // `current === -1` is the "nothing focused yet" sentinel, not a real
  // wrapped-around position: ArrowDown from there should land on the first
  // item and ArrowUp on the last, not "one step past" a virtual -1 slot.
  if (current === -1) {
    return direction === 1 ? 0 : itemCount - 1;
  }

  return (current + direction + itemCount) % itemCount;
}
