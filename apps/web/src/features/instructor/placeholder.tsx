"use client";

import { usePathname } from "next/navigation";
import { useI18n } from "@/lib/i18n/i18n";
import { instructorSections, resolveInstructorSection } from "./navigation";

/**
 * Shared stub for sections not yet built (students/courses/media/quizzes/
 * progress/notifications). Resolves its own section label from the current
 * pathname via navigation.ts, so every stub page is just `<Placeholder />`
 * with no props to keep in sync.
 */
export function Placeholder() {
  const pathname = usePathname();
  const { t } = useI18n();
  const section = resolveInstructorSection(pathname);
  const label = section ? t(instructorSections.find((item) => item.id === section)!.labelKey) : "";

  return (
    <section className="placeholder-panel" aria-labelledby="placeholder-title">
      <p>{label}</p>
      <h2 id="placeholder-title">{t("placeholder.title")}</h2>
      <p>{t("placeholder.copy")}</p>
    </section>
  );
}
