import type { TranslationKey } from "@/lib/i18n/translations";

export type LibraryContentType = "videos" | "documents" | "quizzes";

export type LibraryTab = {
  id: LibraryContentType;
  labelKey: TranslationKey;
  href: string;
  actionKey: TranslationKey;
};

export const libraryTabs: LibraryTab[] = [
  { id: "videos", labelKey: "library.tabVideos", href: "/instructor/library/videos", actionKey: "media.uploadVideoAction" },
  { id: "documents", labelKey: "library.tabDocuments", href: "/instructor/library/documents", actionKey: "media.uploadDocumentAction" },
  { id: "quizzes", labelKey: "library.tabQuizzes", href: "/instructor/library/quizzes", actionKey: "quizzes.createAction" },
];

export const legacyMediaDestination = "/instructor/library";

export function resolveLibraryContentType(pathname: string): LibraryContentType {
  const normalizedPathname = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;

  if (matchesRoutePrefix(normalizedPathname, "/instructor/library/documents")) {
    return "documents";
  }

  if (matchesRoutePrefix(normalizedPathname, "/instructor/library/quizzes") || matchesRoutePrefix(normalizedPathname, "/instructor/quizzes")) {
    return "quizzes";
  }

  return "videos";
}

export function getLibraryTab(type: LibraryContentType): LibraryTab {
  return libraryTabs.find((tab) => tab.id === type) ?? libraryTabs[0];
}

function matchesRoutePrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}
