import type { ReactElement, SVGProps } from "react";
import type { InstructorSection } from "./navigation";

/**
 * Minimal line icons for the sidebar/drawer navigation, one per
 * InstructorSection. Kept as inline SVG (no icon font/library dependency,
 * consistent with the shell's existing CSS-drawn shapes like the mobile
 * menu bars and the back/view-all arrows) - every path uses `currentColor`
 * so hover/active/theme color changes apply for free through the nav
 * link's own `color`.
 */
const ICON_PROPS: SVGProps<SVGSVGElement> = {
  width: 20,
  height: 20,
  viewBox: "0 0 20 20",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
};

function HomeIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M3 9.2 10 3l7 6.2" />
      <path d="M5.1 8.2v8.1h9.8V8.2" />
      <path d="M8.2 16.3v-4.7h3.6v4.7" />
    </svg>
  );
}

function StudentsIcon() {
  return (
    <svg {...ICON_PROPS}>
      <circle cx="7.4" cy="6.3" r="2.55" />
      <path d="M2.6 17c0-2.9 2.15-4.7 4.8-4.7s4.8 1.8 4.8 4.7" />
      <circle cx="14.1" cy="5.2" r="1.9" />
      <path d="M13.1 12.55c2.1.2 3.9 1.85 3.9 4.45" />
    </svg>
  );
}

function CoursesIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M3 4.4c1.4-.9 3.4-1.15 6.5.15v11.9c-3.1-1.3-5.1-1.05-6.5-.15Z" />
      <path d="M17 4.4c-1.4-.9-3.4-1.15-6.5.15v11.9c3.1-1.3 5.1-1.05 6.5-.15Z" />
    </svg>
  );
}

function LibraryIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M4 4.2h8.4a2.2 2.2 0 0 1 2.2 2.2v10.1H6.2A2.2 2.2 0 0 1 4 14.3Z" />
      <path d="M7 7.1h4.6M7 10h4.6" />
      <path d="M14.6 6.2H16a1.7 1.7 0 0 1 1.7 1.7v8.6h-3.1" />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg {...ICON_PROPS}>
      <circle cx="4.5" cy="10" r="1.25" fill="currentColor" stroke="none" />
      <circle cx="10" cy="10" r="1.25" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="10" r="1.25" fill="currentColor" stroke="none" />
    </svg>
  );
}

function ProgressIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M3 17V8.4M9.4 17V3M15.8 17v-6.6" />
    </svg>
  );
}

const NAV_ICONS: Record<InstructorSection, () => ReactElement> = {
  home: HomeIcon,
  courses: CoursesIcon,
  students: StudentsIcon,
  library: LibraryIcon,
  progress: ProgressIcon,
  more: MoreIcon,
};

export function NavIcon({ section }: { section: InstructorSection }) {
  const Icon = NAV_ICONS[section];
  return <Icon />;
}
