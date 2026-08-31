import type { CourseSectionSummary } from "../../../../lib/api/types";
import { canReorderSection } from "./lifecycle";

/**
 * The reorderable subset, in current order - archived sections are excluded
 * (see lifecycle.ts's canReorderSection) and never appear in a reorder
 * request; they keep their own retained position untouched regardless of
 * where they sit in the full list.
 */
export function reorderableSectionIds(sections: CourseSectionSummary[]): string[] {
  return sections.filter((section) => canReorderSection(section.status)).map((section) => section.sectionId);
}

/**
 * Returns the reorderable ID list with `sectionId` swapped one place earlier,
 * or null if it's already first (or not present) - callers use null to keep
 * a "move earlier" control disabled rather than submitting a no-op request.
 */
export function moveEarlier(order: readonly string[], sectionId: string): string[] | null {
  const index = order.indexOf(sectionId);

  if (index <= 0) {
    return null;
  }

  const next = [...order];
  [next[index - 1], next[index]] = [next[index], next[index - 1]];
  return next;
}

/**
 * Returns the reorderable ID list with `sectionId` swapped one place later,
 * or null if it's already last (or not present).
 */
export function moveLater(order: readonly string[], sectionId: string): string[] | null {
  const index = order.indexOf(sectionId);

  if (index === -1 || index >= order.length - 1) {
    return null;
  }

  const next = [...order];
  [next[index], next[index + 1]] = [next[index + 1], next[index]];
  return next;
}
