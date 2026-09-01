"use client";

import { useRef, useState } from "react";
import { useI18n } from "@/lib/i18n/i18n";
import { CourseProgressPanel } from "./course-progress-panel";
import { QuizResultsPanel } from "./quiz-results-panel";

type ProgressTab = "progress" | "results";

const TAB_IDS: ProgressTab[] = ["progress", "results"];

/**
 * Instructor Progress & Quiz Results reporting (Slice G) - two read-only
 * reporting areas as tabs, mirroring the Media Management Documents/Videos
 * tab pattern (see media-page.tsx) rather than separate nested routes.
 * Implements the WAI-ARIA APG manual-activation tabs pattern: `Tab` moves
 * focus into/out of the tablist as one stop, `ArrowLeft`/`ArrowRight` move
 * focus between tabs (wrapping), and activation follows focus.
 */
export function ProgressPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<ProgressTab>("progress");
  const tabRefs = useRef<Partial<Record<ProgressTab, HTMLButtonElement | null>>>({});

  function activate(next: ProgressTab) {
    setTab(next);
    tabRefs.current[next]?.focus();
  }

  function onTabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    const currentIndex = TAB_IDS.indexOf(tab);

    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      const direction = event.key === "ArrowRight" ? 1 : -1;
      const nextIndex = (currentIndex + direction + TAB_IDS.length) % TAB_IDS.length;
      activate(TAB_IDS[nextIndex]);
    } else if (event.key === "Home") {
      event.preventDefault();
      activate(TAB_IDS[0]);
    } else if (event.key === "End") {
      event.preventDefault();
      activate(TAB_IDS[TAB_IDS.length - 1]);
    }
  }

  return (
    <div className="progress-page">
      <div className="page-header">
        <div>
          <h2>{t("nav.progress")}</h2>
          <p className="page-subtitle">{t("progress.subtitle")}</p>
        </div>
      </div>

      <div className="progress-tablist" role="tablist" aria-label={t("nav.progress")}>
        <button
          ref={(el) => {
            tabRefs.current.progress = el;
          }}
          className="progress-tab"
          type="button"
          role="tab"
          id="progress-tab-progress"
          aria-selected={tab === "progress"}
          aria-controls="progress-tabpanel-progress"
          tabIndex={tab === "progress" ? 0 : -1}
          onClick={() => activate("progress")}
          onKeyDown={onTabKeyDown}
        >
          {t("progress.tabProgress")}
        </button>
        <button
          ref={(el) => {
            tabRefs.current.results = el;
          }}
          className="progress-tab"
          type="button"
          role="tab"
          id="progress-tab-results"
          aria-selected={tab === "results"}
          aria-controls="progress-tabpanel-results"
          tabIndex={tab === "results" ? 0 : -1}
          onClick={() => activate("results")}
          onKeyDown={onTabKeyDown}
        >
          {t("progress.tabResults")}
        </button>
      </div>

      <div id="progress-tabpanel-progress" role="tabpanel" aria-labelledby="progress-tab-progress" hidden={tab !== "progress"}>
        {tab === "progress" ? <CourseProgressPanel /> : null}
      </div>

      <div id="progress-tabpanel-results" role="tabpanel" aria-labelledby="progress-tab-results" hidden={tab !== "results"}>
        {tab === "results" ? <QuizResultsPanel /> : null}
      </div>
    </div>
  );
}
