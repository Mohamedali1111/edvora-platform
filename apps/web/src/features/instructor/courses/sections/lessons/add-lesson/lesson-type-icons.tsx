import type { SVGProps } from "react";
import type { LessonType } from "@/lib/api/types";

/**
 * Large, distinct-per-type icons for the Add Lesson type-choice step (Part 3
 * of the authoring redesign) - matching `nav-icons.tsx`'s inline-SVG,
 * `currentColor`, no-icon-library convention, but bigger and one dedicated
 * shape per Lesson type (the sidebar's single `MediaIcon` covers both Video
 * and Document, which isn't distinct enough for a type-choice control).
 */
const ICON_PROPS: SVGProps<SVGSVGElement> = {
  width: 28,
  height: 28,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
};

function VideoTypeIcon() {
  return (
    <svg {...ICON_PROPS}>
      <rect x="2.75" y="5" width="14.5" height="14" rx="2" />
      <path d="M9.6 9.1 14 12l-4.4 2.9Z" fill="currentColor" stroke="none" />
      <path d="m17.25 10.4 4-2.55v8.3l-4-2.55" />
    </svg>
  );
}

function DocumentTypeIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M6 2.75h8.4L19 7.35V21.25H6Z" />
      <path d="M14.1 2.75v4.6h4.6" />
      <path d="M8.6 12.5h6.8M8.6 15.6h6.8M8.6 18.7h4.2" />
    </svg>
  );
}

function QuizTypeIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M5 2.75h14v18.5H5z" />
      <path d="M8.2 7.6h7.6M8.2 11.4h7.6M8.2 15.2h4.6" />
      <circle cx="7" cy="18.2" r="1.05" fill="currentColor" stroke="none" />
      <circle cx="10.4" cy="18.2" r="1.05" fill="currentColor" stroke="none" />
    </svg>
  );
}

const LESSON_TYPE_ICONS: Record<LessonType, () => React.ReactElement> = {
  VIDEO: VideoTypeIcon,
  DOCUMENT: DocumentTypeIcon,
  QUIZ: QuizTypeIcon,
};

export function LessonTypeIcon({ type }: { type: LessonType }) {
  const Icon = LESSON_TYPE_ICONS[type];
  return <Icon />;
}
