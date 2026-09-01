/**
 * Move-earlier/move-later affordance icons shared by the Sections and
 * Lessons reorder buttons. Both lists are vertical (`<ol>`), so "earlier"
 * and "later" are visually up/down, not left/right - unlike the shell's
 * `:dir(rtl)`-mirrored chevrons (back-link, view-all), these deliberately
 * do NOT flip in RTL, since "up" and "down" mean the same thing regardless
 * of text direction.
 */
export function MoveEarlierIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4.5 12.5 10 7l5.5 5.5" />
    </svg>
  );
}

export function MoveLaterIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4.5 7.5 10 13l5.5-5.5" />
    </svg>
  );
}
