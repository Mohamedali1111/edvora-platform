"use client";

import { useI18n } from "@/lib/i18n/i18n";
import type { TranslationKey } from "@/lib/i18n/translations";
import type { LessonType } from "@/lib/api/types";
import type { ReadinessBlocker } from "./readiness";
import { useCourseReadiness } from "./readiness-data";
import { isNetworkError } from "./error-mapping";

const CONTENT_NOT_READY_KEY: Record<LessonType, TranslationKey> = {
  VIDEO: "courses.readinessVideoProcessing",
  DOCUMENT: "courses.readinessDocumentNotReady",
  QUIZ: "courses.readinessQuizNotPublished",
};

const CONTENT_UNKNOWN_KEY: Record<LessonType, TranslationKey> = {
  VIDEO: "courses.readinessUnknownVideo",
  DOCUMENT: "courses.readinessUnknownDocument",
  QUIZ: "courses.readinessUnknownQuiz",
};

/**
 * The readiness state/copy itself, with no surrounding chrome - reused by
 * both the Course Detail page's own readiness section (`readiness-panel.tsx`,
 * wrapped in a `<section>`) and the publish confirmation dialog (Part 7:
 * "before course publication, show a clear confirmation/readiness
 * summary" - embedded directly in `LifecycleConfirmDialog`'s existing copy
 * area). See readiness.ts/readiness-data.ts for the derivation itself.
 */
export function CourseReadinessSummary({
  tenantId,
  courseId,
  contentVersion,
}: {
  tenantId: string;
  courseId: string;
  /**
   * Bumped by the Course Detail page after an in-page Section/Lesson
   * create or lifecycle mutation - see `useCourseReadiness`'s docstring.
   * The publish confirmation dialog (`lifecycle-confirm-dialog.tsx`) has no
   * such tracked version of its own (it's a fresh mount every time it
   * opens), so it always passes `0`, which is fine: mounting fresh already
   * fetches current data once, and the dialog is too short-lived for
   * further staleness to accumulate inside it.
   */
  contentVersion: number;
}) {
  const { t } = useI18n();
  const { state, retry } = useCourseReadiness(tenantId, courseId, contentVersion);

  if (state.status === "loading") {
    return (
      <p className="overview-loading" role="status">
        {t("courses.readinessChecking")}
      </p>
    );
  }

  if (state.status === "error") {
    return (
      <div className="overview-error" role="alert">
        <p>{isNetworkError(state.error) ? t("shell.apiUnavailable") : t("courses.readinessLoadError")}</p>
        <button className="secondary-button compact-action" type="button" onClick={retry}>
          {t("shell.retry")}
        </button>
      </div>
    );
  }

  if (state.data.ready) {
    return (
      <>
        <p className="course-readiness-ready" role="status">
          <span className="status-badge status-badge-published">{t("courses.readinessReady")}</span> {t("courses.readinessReadyNote")}
        </p>
        <RefreshRow onRefresh={retry} />
      </>
    );
  }

  return (
    <>
      <p className="form-note">{t("courses.readinessBlockedCount").replace("{count}", String(state.data.blockers.length))}</p>
      <ul className="course-readiness-list">
        {state.data.blockers.map((blocker, index) => (
          <li key={index}>{blockerCopy(blocker, t)}</li>
        ))}
      </ul>
      <RefreshRow onRefresh={retry} />
    </>
  );
}

/**
 * Section/Lesson create and lifecycle changes made on this same page
 * refresh readiness automatically (see `useCourseReadiness`'s docstring).
 * Quiz and Media are authored on their own separate routes with no
 * cross-tab live sync (deliberately not built) - this is the honest,
 * always-available way to pull in a Quiz publish or Media upload made
 * elsewhere without leaving this page, rather than silently showing
 * whatever was true when this page/dialog last loaded.
 */
function RefreshRow({ onRefresh }: { onRefresh: () => void }) {
  const { t } = useI18n();

  return (
    <div className="course-readiness-refresh-row">
      <p className="form-note">{t("courses.readinessElsewhereNote")}</p>
      <button className="ghost-button compact" type="button" onClick={onRefresh}>
        {t("courses.readinessRefreshAction")}
      </button>
    </div>
  );
}

function blockerCopy(blocker: ReadinessBlocker, t: (key: TranslationKey) => string): string {
  if (blocker.kind === "draftSection") {
    return t("courses.readinessDraftSection").replace("{title}", blocker.sectionTitle);
  }

  if (blocker.kind === "draftLesson") {
    return t("courses.readinessDraftLesson").replace("{title}", blocker.lessonTitle);
  }

  if (blocker.kind === "contentNotReady") {
    return t(CONTENT_NOT_READY_KEY[blocker.contentType]).replace("{title}", blocker.lessonTitle);
  }

  return t(CONTENT_UNKNOWN_KEY[blocker.contentType]).replace("{title}", blocker.lessonTitle);
}
