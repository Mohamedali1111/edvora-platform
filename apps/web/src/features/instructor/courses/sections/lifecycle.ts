import type { SectionStatus } from "../../../../lib/api/types";

/**
 * The backend's Section transitions (confirmed against CourseSectionService,
 * matching Course's DEC-0048 enforcement exactly, including the 2026-09-03
 * Take Offline/Restore addenda): DRAFT -> PUBLISHED, DRAFT -> ARCHIVED,
 * PUBLISHED -> ARCHIVED, PUBLISHED -> DRAFT (Take Offline), and
 * ARCHIVED -> DRAFT (Restore). A Section's own status is the only thing that
 * governs its own editability/lifecycle actions: the backend never checks the
 * parent Course's status in any Section service method, and
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

export function canTakeSectionOffline(status: SectionStatus): boolean {
  return status === "PUBLISHED";
}

export function canArchiveSection(status: SectionStatus): boolean {
  return status === "DRAFT" || status === "PUBLISHED";
}

export function canRestoreSection(status: SectionStatus): boolean {
  return status === "ARCHIVED";
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

export function isSectionArchived(status: SectionStatus): boolean {
  return status === "ARCHIVED";
}
