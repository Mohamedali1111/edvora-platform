import type { ReactElement, SVGProps } from "react";
import type { AdminSection } from "./navigation";

/**
 * Minimal line icons for the admin sidebar/drawer navigation, matching
 * features/instructor/nav-icons.tsx's inline-SVG/`currentColor` convention
 * (kept as its own small file rather than importing that one, per the "don't
 * mix admin into instructor feature modules" rule - see AGENTS.md/the
 * milestone brief).
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

function DeviceRequestsIcon() {
  return (
    <svg {...ICON_PROPS}>
      <rect x="4.4" y="2.6" width="7.6" height="12.4" rx="1.5" />
      <path d="M7.4 12.6h1.6" />
      <path d="M13.4 6.4h2.4v8.6a1.6 1.6 0 0 1-1.6 1.6h-2.8" />
      <path d="M15.05 6.9 16.7 8.55l-2.9 2.9" />
    </svg>
  );
}

function InstructorsIcon() {
  return (
    <svg {...ICON_PROPS}>
      <circle cx="7.4" cy="6.3" r="2.55" />
      <path d="M2.6 17c0-2.9 2.15-4.7 4.8-4.7s4.8 1.8 4.8 4.7" />
      <circle cx="14.1" cy="5.2" r="1.9" />
      <path d="M13.1 12.55c2.1.2 3.9 1.85 3.9 4.45" />
    </svg>
  );
}

const NAV_ICONS: Record<AdminSection, () => ReactElement> = {
  overview: OverviewIcon,
  deviceRequests: DeviceRequestsIcon,
  instructors: InstructorsIcon,
};

export function AdminNavIcon({ section }: { section: AdminSection }) {
  const Icon = NAV_ICONS[section];
  return <Icon />;
}
