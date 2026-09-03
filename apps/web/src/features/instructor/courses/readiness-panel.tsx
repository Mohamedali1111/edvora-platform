"use client";

import { useI18n } from "@/lib/i18n/i18n";
import { CourseReadinessSummary } from "./readiness-summary";

/**
 * Compact "what will students see if I publish this?" surface for the
 * Course Detail page (Part 7 of the authoring redesign) - section chrome
 * around `CourseReadinessSummary`, the shared state/copy also embedded in
 * the publish confirmation dialog.
 */
export function CourseReadinessPanel({
  tenantId,
  courseId,
  contentVersion,
}: {
  tenantId: string;
  courseId: string;
  contentVersion: number;
}) {
  const { t } = useI18n();

  return (
    <section className="detail-section course-readiness-panel" aria-labelledby="course-readiness-heading">
      <div className="detail-section-header">
        <h2 id="course-readiness-heading">{t("courses.readinessHeading")}</h2>
      </div>
      <CourseReadinessSummary tenantId={tenantId} courseId={courseId} contentVersion={contentVersion} />
    </section>
  );
}
