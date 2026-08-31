import type { TranslationKey } from "@/lib/i18n/translations";

export type InstructorSection =
  | "overview"
  | "students"
  | "courses"
  | "media"
  | "quizzes"
  | "progress"
  | "notifications";

export const instructorSections: Array<{ id: InstructorSection; labelKey: TranslationKey; href: string }> = [
  { id: "overview", labelKey: "nav.overview", href: "/instructor/overview" },
  { id: "students", labelKey: "nav.students", href: "/instructor/students" },
  { id: "courses", labelKey: "nav.courses", href: "/instructor/courses" },
  { id: "media", labelKey: "nav.media", href: "/instructor/media" },
  { id: "quizzes", labelKey: "nav.quizzes", href: "/instructor/quizzes" },
  { id: "progress", labelKey: "nav.progress", href: "/instructor/progress" },
  { id: "notifications", labelKey: "nav.notifications", href: "/instructor/notifications" },
];

/**
 * Resolves the active instructor section from a pathname alone - pure and
 * synchronous, with no dependency on auth/session state. Returns null for a
 * path that doesn't match any known section (e.g. a typo'd URL), which the
 * shell renders as an in-shell "page not found" state instead of guessing.
 */
export function resolveInstructorSection(pathname: string): InstructorSection | null {
  const match = instructorSections.find((section) => pathname === section.href || pathname.startsWith(`${section.href}/`));
  return match ? match.id : null;
}
