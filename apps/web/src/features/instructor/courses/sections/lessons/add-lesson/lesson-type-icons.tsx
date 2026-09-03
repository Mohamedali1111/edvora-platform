import type { SVGProps } from "react";
import type { LessonType } from "@/lib/api/types";

/**
 * Distinct-per-type icons for the Lesson type - originally built for the Add
 * Lesson type-choice step (Part 3 of the authoring redesign, at the default
 * 28px size below), matching `nav-icons.tsx`'s inline-SVG, `currentColor`,
 * no-icon-library convention. Reused smaller (`size` prop) inside the
 * Chapter builder's Lesson-row type badge and the First-Publish Review's
 * Lesson list, so a Lesson's type reads as a shape as well as a label - the
 * sidebar's single `MediaIcon` covers both Video and Document, which isn't
 * distinct enough for either use.
 */
const BASE_ICON_PROPS: Omit<SVGProps<SVGSVGElement>, "width" | "height"> = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
};

function VideoTypeIcon({ size }: { size: number }) {
  return (
    <svg {...BASE_ICON_PROPS} width={size} height={size}>
      <rect x="2.75" y="5" width="14.5" height="14" rx="2" />
      <path d="M9.6 9.1 14 12l-4.4 2.9Z" fill="currentColor" stroke="none" />
      <path d="m17.25 10.4 4-2.55v8.3l-4-2.55" />
    </svg>
  );
}

function DocumentTypeIcon({ size }: { size: number }) {
  return (
    <svg {...BASE_ICON_PROPS} width={size} height={size}>
      <path d="M6 2.75h8.4L19 7.35V21.25H6Z" />
      <path d="M14.1 2.75v4.6h4.6" />
      <path d="M8.6 12.5h6.8M8.6 15.6h6.8M8.6 18.7h4.2" />
    </svg>
  );
}

function QuizTypeIcon({ size }: { size: number }) {
  return (
    <svg {...BASE_ICON_PROPS} width={size} height={size}>
      <path d="M5 2.75h14v18.5H5z" />
      <path d="M8.2 7.6h7.6M8.2 11.4h7.6M8.2 15.2h4.6" />
      <circle cx="7" cy="18.2" r="1.05" fill="currentColor" stroke="none" />
      <circle cx="10.4" cy="18.2" r="1.05" fill="currentColor" stroke="none" />
    </svg>
  );
}

const LESSON_TYPE_ICONS: Record<LessonType, (props: { size: number }) => React.ReactElement> = {
  VIDEO: VideoTypeIcon,
  DOCUMENT: DocumentTypeIcon,
  QUIZ: QuizTypeIcon,
};

/**
 * `size` defaults to 28 (the Add Lesson type-choice card's original size) so
 * every existing call site is unaffected; pass a smaller value (e.g. 14) for
 * an inline badge. Always `aria-hidden` - a Lesson's type is never conveyed
 * by this icon alone, only alongside its existing text label (lessons.type*
 * translation keys), never as the icon's sole accessible meaning.
 */
export function LessonTypeIcon({ type, size = 28 }: { type: LessonType; size?: number }) {
  const Icon = LESSON_TYPE_ICONS[type];
  return <Icon size={size} />;
}
