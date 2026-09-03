"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n/i18n";
import type { CourseReadiness } from "@/lib/api/types";
import { isNetworkError } from "./error-mapping";
import { readinessIssueMessage } from "./readiness-copy";
import type { CourseReadinessLoadState } from "./readiness-data";

const MAX_VISIBLE_ISSUES = 4;

/**
 * The Course Builder's compact "can I publish something now?" attention
 * area (product review Part: Readiness Strip). Deliberately not a big
 * dashboard card - a short status line, an optional collapsed issue list,
 * and (only when it means something) one CTA. Presentational: the Course
 * Builder page (course-detail.tsx) owns the one `useCourseReadiness` fetch
 * this page needs (also reused for the per-Lesson content-readiness join)
 * and passes its `state` straight through here.
 *
 * Two distinct modes, chosen by the caller rather than derived here,
 * because the underlying product question genuinely differs:
 *
 * - `firstPublish` (a never-published Draft Course - see first-publish.ts's
 *   `isFirstPublishEligible`): the full Ready / Partially ready / Nothing
 *   publishable treatment, with a "Review & publish" CTA whenever at least
 *   one Lesson is ready.
 * - `contentHealth` (every other non-Archived Course - Live, or a Draft
 *   Course that's been live before): never repeats "ready to publish"
 *   messaging - Take Offline already preserved every descendant's own
 *   status, so there is no fresh selection to review here. Renders nothing
 *   at all when there's nothing to flag, and a quiet, collapsible "N items
 *   need attention" line otherwise.
 *
 * Archived Courses never render this at all (readiness is secondary to
 * Restore there) - the caller simply doesn't mount it, and a Course with no
 * Chapters yet doesn't either, since the builder's own empty state already
 * owns "add your first chapter" messaging.
 */
export function ReadinessStrip({
  state,
  mode,
  onRefresh,
  onReviewAndPublish,
}: {
  state: CourseReadinessLoadState;
  mode: "firstPublish" | "contentHealth";
  onRefresh: () => void;
  /** Opens the First-Publish Review flow - only ever called from `firstPublish` mode. */
  onReviewAndPublish: () => void;
}) {
  const { t } = useI18n();

  if (state.status === "loading") {
    return (
      <p className="readiness-strip readiness-strip-loading" role="status">
        {t("courses.readinessChecking")}
      </p>
    );
  }

  if (state.status === "error") {
    return (
      <div className="readiness-strip readiness-strip-error" role="alert">
        <p>{isNetworkError(state.error) ? t("shell.apiUnavailable") : t("courses.readinessLoadError")}</p>
        <button className="ghost-button compact" type="button" onClick={onRefresh}>
          {t("shell.retry")}
        </button>
      </div>
    );
  }

  return mode === "firstPublish" ? (
    <FirstPublishStrip readiness={state.data} onRefresh={onRefresh} onReviewAndPublish={onReviewAndPublish} />
  ) : (
    <ContentHealthStrip readiness={state.data} onRefresh={onRefresh} />
  );
}

function FirstPublishStrip({
  readiness,
  onRefresh,
  onReviewAndPublish,
}: {
  readiness: CourseReadiness;
  onRefresh: () => void;
  onReviewAndPublish: () => void;
}) {
  const { t } = useI18n();
  const readyCount = readiness.readyToPublish.lessons.length;
  const issueCount = readiness.blockers.length;

  if (readyCount === 0) {
    // "Nothing publishable" - explain the most important blockers instead of
    // a fake disabled CTA. If there are truly no blockers either (a brand
    // new, still-empty Chapter with nothing authored under it yet), this
    // renders nothing - the builder's own empty state below already
    // explains the next step, and repeating it here would be noise.
    if (issueCount === 0) {
      return null;
    }

    return (
      <div className="readiness-strip readiness-strip-blocked">
        <p className="readiness-strip-title">{t("courses.readinessStripNothingTitle")}</p>
        <IssueList issues={readiness.blockers} />
        <RefreshNote onRefresh={onRefresh} />
      </div>
    );
  }

  return (
    <div className="readiness-strip readiness-strip-ready">
      <div className="readiness-strip-main">
        <p className="readiness-strip-title">
          {issueCount > 0
            ? t("courses.readinessStripPartialNote").replace("{readyCount}", String(readyCount)).replace("{issueCount}", String(issueCount))
            : t("courses.readinessStripReadyToPublish").replace("{count}", String(readyCount))}
        </p>
        <button className="primary-button compact-action" type="button" onClick={onReviewAndPublish}>
          {t("courses.reviewAndPublishAction")}
        </button>
      </div>
      {issueCount > 0 ? <IssueList issues={readiness.blockers} /> : null}
      <RefreshNote onRefresh={onRefresh} />
    </div>
  );
}

function ContentHealthStrip({ readiness, onRefresh }: { readiness: CourseReadiness; onRefresh: () => void }) {
  const { t } = useI18n();

  if (readiness.blockers.length === 0) {
    return null;
  }

  return (
    <div className="readiness-strip readiness-strip-health">
      <p className="readiness-strip-title">{t("courses.readinessStripAttentionCount").replace("{count}", String(readiness.blockers.length))}</p>
      <IssueList issues={readiness.blockers} />
      <RefreshNote onRefresh={onRefresh} />
    </div>
  );
}

function IssueList({ issues }: { issues: CourseReadiness["blockers"] }) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? issues : issues.slice(0, MAX_VISIBLE_ISSUES);
  const remaining = issues.length - visible.length;

  return (
    <div className="readiness-issue-block">
      <ul className="readiness-issue-list">
        {visible.map((issue, index) => (
          <li key={`${issue.entityType}-${issue.entityId}-${index}`}>{readinessIssueMessage(issue, t)}</li>
        ))}
      </ul>
      {remaining > 0 ? (
        <button className="ghost-button compact" type="button" onClick={() => setExpanded(true)}>
          {t("courses.readinessStripViewDetails").replace("{count}", String(remaining))}
        </button>
      ) : null}
    </div>
  );
}

/**
 * Chapter/Lesson create and lifecycle changes made on this same page
 * refresh readiness automatically (see readiness-data.ts). Quiz and Media
 * are authored on their own separate routes with no cross-tab live sync
 * (deliberately not built) - this is the honest, always-available way to
 * pull in a Quiz publish or Media upload made elsewhere without leaving
 * this page.
 */
function RefreshNote({ onRefresh }: { onRefresh: () => void }) {
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
