import type { SectionStatus } from "../../../../lib/api/types";

/**
 * The frozen backend's Section transitions (confirmed against
 * CourseSectionService, matching Course's DEC-0048 enforcement exactly):
 * DRAFT -> PUBLISHED, DRAFT -> ARCHIVED, PUBLISHED -> ARCHIVED. ARCHIVED is
 * terminal - no unpublish, no restore. A Section's own status is the only
 * thing that governs its own editability/lifecycle actions: the backend
 * never checks the parent Course's status in any Section service method, and
 * docs/BACKEND-DOMAIN.md confirms this is deliberate ("Archiving does not
 * cascade... preserving descendant authoring state") - so these helpers
 * intentionally take only the Section's status, never the Course's.
 */
export function canEditSectionMetadata(status: SectionStatus): boolean {
  return status !== "ARCHIVED";
}

export function canPublishSection(status: SectionStatus): boolean {
  return status === "DRAFT";
}

export function canArchiveSection(status: SectionStatus): boolean {
  return status === "DRAFT" || status === "PUBLISHED";
}

/**
 * Whether a section may appear in a reorder request. The backend's reorder
 * endpoint requires the submitted `sectionIds` to be exactly the set of
 * non-ARCHIVED sections for the course - an archived section retains its own
 * position permanently and is rejected (INVALID_SECTION_REORDER) if included.
 */
export function canReorderSection(status: SectionStatus): boolean {
  return status !== "ARCHIVED";
}

export function isSectionTerminal(status: SectionStatus): boolean {
  return status === "ARCHIVED";
}
