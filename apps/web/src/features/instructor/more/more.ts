import type { TranslationKey } from "@/lib/i18n/translations";

export type MoreDestinationVisibility = "all" | "mobile";

export type MoreDestination = {
  id: "progress" | "notifications";
  labelKey: TranslationKey;
  href: string;
  visibility: MoreDestinationVisibility;
};

export const moreDestinations: MoreDestination[] = [
  { id: "progress", labelKey: "nav.progress", href: "/instructor/progress", visibility: "mobile" },
  { id: "notifications", labelKey: "nav.notifications", href: "/instructor/notifications", visibility: "all" },
];

export function getDesktopMoreDestinations(): MoreDestination[] {
  return moreDestinations.filter((destination) => destination.visibility === "all");
}

export function getMobileMoreDestinations(): MoreDestination[] {
  return moreDestinations;
}
