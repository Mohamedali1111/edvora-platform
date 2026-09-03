import type { TranslationKey } from "@/lib/i18n/translations";

export type InstructorSection =
  | "home"
  | "courses"
  | "students"
  | "library"
  | "progress"
  | "more";

export type InstructorNavItem = {
  id: InstructorSection;
  labelKey: TranslationKey;
  href: string;
};

export const instructorPrimarySections: InstructorNavItem[] = [
  { id: "home", labelKey: "nav.home", href: "/instructor/overview" },
  { id: "courses", labelKey: "nav.courses", href: "/instructor/courses" },
  { id: "students", labelKey: "nav.students", href: "/instructor/students" },
  { id: "library", labelKey: "nav.library", href: "/instructor/library" },
  { id: "progress", labelKey: "nav.progress", href: "/instructor/progress" },
  { id: "more", labelKey: "nav.more", href: "/instructor/more" },
];

export const instructorMobileSections: InstructorNavItem[] = [
  { id: "home", labelKey: "nav.home", href: "/instructor/overview" },
  { id: "courses", labelKey: "nav.courses", href: "/instructor/courses" },
  { id: "students", labelKey: "nav.students", href: "/instructor/students" },
  { id: "library", labelKey: "nav.library", href: "/instructor/library" },
  { id: "more", labelKey: "nav.more", href: "/instructor/more" },
];

const ROUTE_SECTION_PATTERNS: Array<{ section: InstructorSection; prefixes: string[] }> = [
  { section: "home", prefixes: ["/instructor/overview"] },
  { section: "courses", prefixes: ["/instructor/courses"] },
  { section: "students", prefixes: ["/instructor/students"] },
  {
    section: "library",
    prefixes: ["/instructor/library", "/instructor/media", "/instructor/quizzes"],
  },
  { section: "progress", prefixes: ["/instructor/progress", "/instructor/reports", "/instructor/analytics"] },
  { section: "more", prefixes: ["/instructor/more", "/instructor/notifications", "/instructor/settings", "/instructor/account"] },
];

/**
 * Resolves the active instructor section from a pathname alone - pure and
 * synchronous, with no dependency on auth/session state. Returns null for a
 * path that doesn't match any known section (e.g. a typo'd URL), which the
 * shell renders as an in-shell "page not found" state instead of guessing.
 */
export function resolveInstructorSection(pathname: string): InstructorSection | null {
  const normalizedPathname = normalizePathname(pathname);

  if (normalizedPathname === "/instructor") {
    return "home";
  }

  for (const routeGroup of ROUTE_SECTION_PATTERNS) {
    if (routeGroup.prefixes.some((prefix) => matchesRoutePrefix(normalizedPathname, prefix))) {
      return routeGroup.section;
    }
  }

  return null;
}

function normalizePathname(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }

  return pathname;
}

function matchesRoutePrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}
