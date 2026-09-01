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

function OverviewIcon() {
  return (
    <svg {...ICON_PROPS}>
      <rect x="2.75" y="2.75" width="6.2" height="6.2" rx="1.4" />
      <rect x="11.05" y="2.75" width="6.2" height="6.2" rx="1.4" />
      <rect x="2.75" y="11.05" width="6.2" height="6.2" rx="1.4" />
      <rect x="11.05" y="11.05" width="6.2" height="6.2" rx="1.4" />
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

function MediaIcon() {
  return (
    <svg {...ICON_PROPS}>
      <rect x="2.6" y="3.4" width="14.8" height="11.2" rx="1.7" />
      <path d="M8.15 6.7 12 9l-3.85 2.3Z" fill="currentColor" stroke="none" />
      <path d="M6 17.1h8" />
    </svg>
  );
}

function QuizzesIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M5 2.75h10v14.5H5z" />
      <path d="M7.6 6.6h4.8M7.6 9.6h4.8M7.6 12.6h2.9" />
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

function NotificationsIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M6 8.1a4 4 0 0 1 8 0c0 3.65 1.15 4.75 1.15 4.75H4.85S6 11.75 6 8.1Z" />
      <path d="M8.35 15.6a1.75 1.75 0 0 0 3.3 0" />
    </svg>
  );
}

const NAV_ICONS: Record<InstructorSection, () => ReactElement> = {
  overview: OverviewIcon,
  students: StudentsIcon,
  courses: CoursesIcon,
  media: MediaIcon,
  quizzes: QuizzesIcon,
  progress: ProgressIcon,
  notifications: NotificationsIcon,
};

export function NavIcon({ section }: { section: InstructorSection }) {
  const Icon = NAV_ICONS[section];
  return <Icon />;
}
