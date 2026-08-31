"use client";

import { useRef, useState } from "react";
import { useI18n } from "@/lib/i18n/i18n";
import { DocumentsPanel } from "./documents-panel";
import { VideosPanel } from "./videos-panel";

type MediaTab = "documents" | "videos";

const TAB_IDS: MediaTab[] = ["documents", "videos"];

/**
 * Instructor Media Management - Documents and Videos as two tabs rather
 * than two stacked management surfaces, per Slice E's design guidance.
 * Tab state is component-local (not URL-driven): this is a within-page
 * content switch, not two distinct destinations worth separate routes or
 * back-button stops, matching "avoid unnecessary nested routing."
 * Implements the WAI-ARIA APG manual-activation tabs pattern: `Tab` moves
 * focus into/out of the tablist as one stop, `ArrowLeft`/`ArrowRight` move
 * focus between tabs (wrapping), and activation follows focus.
 */
export function MediaPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<MediaTab>("documents");
  const tabRefs = useRef<Partial<Record<MediaTab, HTMLButtonElement | null>>>({});

  function activate(next: MediaTab) {
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
    <div className="media-page">
      <div className="page-header">
        <div>
          <h2>{t("nav.media")}</h2>
          <p className="page-subtitle">{t("media.subtitle")}</p>
        </div>
      </div>

      <div className="media-tablist" role="tablist" aria-label={t("nav.media")}>
        <button
          ref={(el) => {
            tabRefs.current.documents = el;
          }}
          className="media-tab"
          type="button"
          role="tab"
          id="media-tab-documents"
          aria-selected={tab === "documents"}
          aria-controls="media-tabpanel-documents"
          tabIndex={tab === "documents" ? 0 : -1}
          onClick={() => activate("documents")}
          onKeyDown={onTabKeyDown}
        >
          {t("media.tabDocuments")}
        </button>
        <button
          ref={(el) => {
            tabRefs.current.videos = el;
          }}
          className="media-tab"
          type="button"
          role="tab"
          id="media-tab-videos"
          aria-selected={tab === "videos"}
          aria-controls="media-tabpanel-videos"
          tabIndex={tab === "videos" ? 0 : -1}
          onClick={() => activate("videos")}
          onKeyDown={onTabKeyDown}
        >
          {t("media.tabVideos")}
        </button>
      </div>

      <div
        id="media-tabpanel-documents"
        role="tabpanel"
        aria-labelledby="media-tab-documents"
        hidden={tab !== "documents"}
      >
        {tab === "documents" ? <DocumentsPanel /> : null}
      </div>

      <div id="media-tabpanel-videos" role="tabpanel" aria-labelledby="media-tab-videos" hidden={tab !== "videos"}>
        {tab === "videos" ? <VideosPanel /> : null}
      </div>
    </div>
  );
}
