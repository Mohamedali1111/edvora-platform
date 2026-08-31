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

export function toInstructorSection(value: string | undefined): InstructorSection {
  return instructorSections.some((section) => section.id === value) ? (value as InstructorSection) : "overview";
}
