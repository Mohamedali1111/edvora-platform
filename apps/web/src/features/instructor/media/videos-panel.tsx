"use client";

import { useEffect, useState } from "react";
import { useAuthenticatedInstructorSession } from "@/features/instructor/session-context";
import { formatDate } from "@/features/instructor/students/format";
import { canGoNext, canGoPrevious, nextOffset, previousOffset } from "@/features/instructor/students/pagination";
import { useI18n } from "@/lib/i18n/i18n";
import type { TranslationKey } from "@/lib/i18n/translations";
import type { AssetProcessingStatus } from "@/lib/api/types";
import { MEDIA_PAGE_SIZE, useVideosList } from "./media-service";
import { formatDuration } from "@/features/instructor/courses/sections/lessons/format";
import { shouldPollVideos, VIDEO_POLL_INTERVAL_MS } from "./polling";
import { isNetworkError } from "./error-mapping";
import { UploadVideoDialog } from "./upload-video-dialog";

const ASSET_STATUS_KEY: Record<AssetProcessingStatus, TranslationKey> = {
  UPLOADING: "lessons.assetStatusUploading",
  PROCESSING: "lessons.assetStatusProcessing",
  READY: "lessons.assetStatusReady",
  FAILED: "lessons.assetStatusFailed",
  ARCHIVED: "lessons.assetStatusArchived",
};

/**
 * Video processing is webhook-driven (Bunny -> backend), never something
 * this page triggers - see docs/MEDIA.md. While the current page holds an
 * `UPLOADING`/`PROCESSING` video, this panel silently re-fetches the same
 * page at a bounded interval (`shouldPollVideos`/`VIDEO_POLL_INTERVAL_MS`,
 * polling.ts) so a Bunny webhook's eventual READY/FAILED update appears
 * without the instructor pressing Refresh. Polling stops the moment nothing
 * on the page is still processing, and unmounting (switching to the
 * Documents tab, or navigating away) always clears the interval - it is
 * never left running in the background.
 */
export function VideosPanel() {
  const { tenant } = useAuthenticatedInstructorSession();
  const { t } = useI18n();
  const [offset, setOffset] = useState(0);
  const [uploadOpen, setUploadOpen] = useState(false);
  const { state, retry, refresh } = useVideosList(tenant.tenantId, offset);

  const pollNow = state.status === "ready" && shouldPollVideos(state.data.items);

  useEffect(() => {
    if (!pollNow) {
      return;
    }

    const timer = window.setInterval(() => {
      refresh();
    }, VIDEO_POLL_INTERVAL_MS);

    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `refresh` is stable per render key (media-service.ts); re-subscribing on every render would restart the interval each tick.
  }, [pollNow, tenant.tenantId, offset]);

  return (
    <div className="media-panel">
      <div className="media-panel-header">
        <button className="primary-button" type="button" onClick={() => setUploadOpen(true)}>
          {t("media.uploadVideoAction")}
        </button>
        {/* Silent refresh (not `retry`) - clicking this should not blank the
            already-populated table back to a loading state. */}
        <button className="ghost-button compact" type="button" onClick={refresh}>
          {t("media.refreshAction")}
        </button>
      </div>

      {state.status === "loading" ? (
        <p className="overview-loading" role="status">
          {t("overview.loading")}
        </p>
      ) : state.status === "error" ? (
        <div className="overview-error" role="alert">
          <p>{isNetworkError(state.error) ? t("shell.apiUnavailable") : t("media.loadError")}</p>
          <button className="secondary-button compact-action" type="button" onClick={retry}>
            {t("shell.retry")}
          </button>
        </div>
      ) : state.data.items.length === 0 ? (
        <p className="overview-empty">{t("media.videosEmpty")}</p>
      ) : (
        <>
          {pollNow ? (
            <p className="media-processing-hint" role="status">
              {t("media.processingHint")}
            </p>
          ) : null}

          <div className="table-scroll">
            <table className="data-table">
              <caption className="sr-only">{t("media.tabVideos")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("media.columnStatus")}</th>
                  <th scope="col" className="table-col-secondary">
                    {t("media.columnDuration")}
                  </th>
                  <th scope="col" className="table-col-secondary">
                    {t("media.columnCreated")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {state.data.items.map((video) => (
                  <tr key={video.videoAssetId}>
                    <td>
                      <span className={`status-badge status-badge-${video.processingStatus.toLowerCase()}`}>
                        {t(ASSET_STATUS_KEY[video.processingStatus])}
                      </span>
                    </td>
                    <td className="table-col-secondary">
                      {video.durationSeconds != null ? formatDuration(video.durationSeconds) : t("lessons.durationUnknown")}
                    </td>
                    <td className="table-col-secondary">{formatDate(video.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="pagination-controls" aria-label={t("pagination.pageLabel")}>
            <button
              className="secondary-button compact"
              type="button"
              onClick={() => setOffset((value) => previousOffset(value, MEDIA_PAGE_SIZE))}
              disabled={!canGoPrevious(offset)}
            >
              {t("pagination.previous")}
            </button>
            <button
              className="secondary-button compact"
              type="button"
              onClick={() => setOffset((value) => nextOffset(value, MEDIA_PAGE_SIZE))}
              disabled={!canGoNext(state.data.hasMore)}
            >
              {t("pagination.next")}
            </button>
          </div>
        </>
      )}

      {uploadOpen ? (
        <UploadVideoDialog
          tenantId={tenant.tenantId}
          onClose={() => setUploadOpen(false)}
          onUploaded={() => {
            setUploadOpen(false);
            setOffset(0);
            retry();
          }}
        />
      ) : null}
    </div>
  );
}
