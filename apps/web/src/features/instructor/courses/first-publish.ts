import type { CourseSummary } from "../../../lib/api/types";

/**
 * The Course Header's single primary action, resolved purely from the
 * Course's own status/publishedAt - the same distinction the Courses list
 * already uses (see courses/lifecycle.ts's `canPublishAgainFromCoursesList`),
 * now driving which flow "the" primary button opens on Course Detail itself:
 *
 * - `reviewAndPublish`: a never-published Draft Course (`publishedAt === null`).
 *   Opens the First-Publish Review (readiness + publish-selected) - must
 *   NEVER call the plain `/publish` endpoint directly, since that would
 *   publish the Course with zero explicitly-reviewed content.
 * - `makeLiveAgain`: a Draft Course that has been live before (`publishedAt`
 *   set - Take Offline never clears it, DEC-0050). Calls the existing
 *   granular `/publish` directly - re-showing the first-publish selection
 *   review here would be wrong: Take Offline is non-cascading, so every
 *   descendant already sits at whatever status it had before, and
 *   `/publish` on the Course itself carries no such selection concept.
 * - `restore`: an Archived Course - Restore is the only thing that matters
 *   here (see docs/DECISIONS.md DEC-0048 2026-09-03 Restore addendum).
 * - `none`: a Live Course. Deliberately no big header CTA - "Manage course"
 *   is meaningless from inside the page that already *is* course
 *   management, and a destructive-looking primary action here would be
 *   exactly the "huge destructive action" the product review rejected.
 *   "Hide from students" (Take Offline) stays reachable, just through the
 *   header's overflow menu like every other secondary lifecycle action.
 */
export type CourseHeaderPrimaryAction = "reviewAndPublish" | "makeLiveAgain" | "restore" | "none";

export function resolveCourseHeaderPrimaryAction(course: Pick<CourseSummary, "status" | "publishedAt">): CourseHeaderPrimaryAction {
  if (course.status === "ARCHIVED") {
    return "restore";
  }

  if (course.status === "DRAFT") {
    return course.publishedAt === null ? "reviewAndPublish" : "makeLiveAgain";
  }

  return "none";
}

/** Whether a Course is eligible for the first-publish selection review at all - used to gate rendering/opening it defensively, independent of how the primary action button itself is labeled. */
export function isFirstPublishEligible(course: Pick<CourseSummary, "status" | "publishedAt">): boolean {
  return course.status === "DRAFT" && course.publishedAt === null;
}
