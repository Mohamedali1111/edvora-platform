import type { TranslationKey } from "@/lib/i18n/translations";

/**
 * Real, backend-supported V1 Platform Admin sections only. "overview" is a
 * restrained operational landing page (no fabricated metrics - see
 * features/admin/overview/overview.tsx); "deviceRequests" is backed by
 * GET/approve/reject on /admin/device-change-requests; "instructors" is
 * backed by GET (list/detail) and POST on /admin/instructors - Platform
 * Admin's Instructor + Tenant onboarding workflow. Nothing else is added
 * here until a real admin-facing endpoint exists for it.
 */
export type AdminSection = "overview" | "deviceRequests" | "instructors";

export const adminSections: Array<{ id: AdminSection; labelKey: TranslationKey; href: string }> = [
  { id: "overview", labelKey: "admin.nav.overview", href: "/admin/overview" },
  { id: "deviceRequests", labelKey: "admin.nav.deviceRequests", href: "/admin/device-requests" },
  { id: "instructors", labelKey: "admin.nav.instructors", href: "/admin/instructors" },
];

/**
 * Resolves the active admin section from a pathname alone - pure and
 * synchronous, with no dependency on auth/session state. Returns null for a
 * path that doesn't match any known section, which the shell renders as an
 * in-shell "page not found" state instead of guessing.
 */
export function resolveAdminSection(pathname: string): AdminSection | null {
  const match = adminSections.find((section) => pathname === section.href || pathname.startsWith(`${section.href}/`));
  return match ? match.id : null;
}
