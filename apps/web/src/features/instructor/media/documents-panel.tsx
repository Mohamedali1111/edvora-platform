"use client";

import { useState } from "react";
import { useAuthenticatedInstructorSession } from "@/features/instructor/session-context";
import { formatDate } from "@/features/instructor/students/format";
import { canGoNext, canGoPrevious, nextOffset, previousOffset } from "@/features/instructor/students/pagination";
import { useI18n } from "@/lib/i18n/i18n";
import type { TranslationKey } from "@/lib/i18n/translations";
import type { AssetProcessingStatus } from "@/lib/api/types";
import { MEDIA_PAGE_SIZE, useDocumentsList } from "./media-service";
import { formatFileSize } from "./format";
import { isNetworkError } from "./error-mapping";
import { UploadDocumentDialog } from "./upload-document-dialog";

const ASSET_STATUS_KEY: Record<AssetProcessingStatus, TranslationKey> = {
  UPLOADING: "lessons.assetStatusUploading",
  PROCESSING: "lessons.assetStatusProcessing",
  READY: "lessons.assetStatusReady",
  FAILED: "lessons.assetStatusFailed",
  ARCHIVED: "lessons.assetStatusArchived",
};

/**
 * Only `application/pdf` exists in V1 (see document-upload.ts), so this is
 * a truthful label for the one real MIME type the backend actually
 * accepts/returns - not a fabricated type system. Any unexpected future
 * value still renders as-is rather than being hidden.
 */
function documentTypeLabel(mimeType: string, t: (key: TranslationKey) => string): string {
  return mimeType === "application/pdf" ? t("media.documentTypePdf") : mimeType;
}

/**
 * Documents are synchronously confirmable (the PUT -> confirm-upload call
 * resolves READY/FAILED in one round trip - see docs/MEDIA.md) - unlike
 * Videos, there is no webhook-driven async state to poll for here, so this
 * panel never polls; a completed upload's result is already final by the
 * time `onUploaded` fires.
 */
export function DocumentsPanel() {
  const { tenant } = useAuthenticatedInstructorSession();
  const { t } = useI18n();
  const [offset, setOffset] = useState(0);
  const [uploadOpen, setUploadOpen] = useState(false);
  const { state, retry } = useDocumentsList(tenant.tenantId, offset);

  return (
    <div className="media-panel">
      <div className="media-panel-header">
        <button className="primary-button" type="button" onClick={() => setUploadOpen(true)}>
          {t("media.uploadDocumentAction")}
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
        <p className="overview-empty">{t("media.documentsEmpty")}</p>
      ) : (
        <>
          <div className="table-scroll">
            <table className="data-table">
              <caption className="sr-only">{t("media.tabDocuments")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("media.columnFileName")}</th>
                  <th scope="col" className="table-col-secondary">
                    {t("media.columnType")}
                  </th>
                  <th scope="col" className="table-col-secondary">
                    {t("media.columnSize")}
                  </th>
                  <th scope="col">{t("media.columnStatus")}</th>
                  <th scope="col" className="table-col-secondary">
                    {t("media.columnCreated")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {state.data.items.map((document_) => (
                  <tr key={document_.documentAssetId}>
                    <td className="media-filename-cell">
                      <strong>{document_.fileName}</strong>
                    </td>
                    <td className="table-col-secondary">{documentTypeLabel(document_.mimeType, t)}</td>
                    <td className="table-col-secondary">{formatFileSize(document_.fileSizeBytes)}</td>
                    <td>
                      <span className={`status-badge status-badge-${document_.processingStatus.toLowerCase()}`}>
                        {t(ASSET_STATUS_KEY[document_.processingStatus])}
                      </span>
                    </td>
                    <td className="table-col-secondary">{formatDate(document_.createdAt)}</td>
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
        <UploadDocumentDialog
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
