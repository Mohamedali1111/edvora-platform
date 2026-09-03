"use client";

import type { FormEvent } from "react";
import { Modal } from "@/features/instructor/students/dialog";
import { useI18n } from "@/lib/i18n/i18n";
import { formatFileSize } from "./format";
import { DOCUMENT_ALLOWED_MIME_TYPES, DOCUMENT_MAX_FILE_SIZE_BYTES, isUploadCapabilityExpired } from "./document-upload";
import { useDocumentUploadFlow, type DocumentUploadFlow } from "./use-document-upload-flow";
import { isNetworkError, resolveErrorMessageKey } from "./error-mapping";

/**
 * Implements the real R2-backed flow via `useDocumentUploadFlow` (initiate
 * -> direct browser PUT to R2 -> confirm, with false-failure reconciliation
 * - see that hook's docstring). This component owns only the standalone
 * Media Library modal chrome; `DocumentUploadFields` below is the shared
 * presentational body also reused, without a `Modal` wrapper, by the
 * in-context "upload new document" step of the Add Lesson flow.
 */
export function UploadDocumentDialog({
  tenantId,
  onClose,
  onUploaded,
}: {
  tenantId: string;
  onClose: () => void;
  onUploaded: () => void;
}) {
  const { t } = useI18n();
  const flow = useDocumentUploadFlow(tenantId, onUploaded);
  const { busy, file, phase } = flow;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    flow.startUpload();
  }

  return (
    <Modal titleId="upload-document-title" onClose={busy ? () => undefined : onClose}>
      <form className="auth-form" onSubmit={submit} noValidate>
        <h2 id="upload-document-title">{t("media.uploadDialogTitleDocument")}</h2>

        <DocumentUploadFields flow={flow} />

        {busy ? (
          // While actively transferring, `DocumentUploadFields` already
          // shows its own progress/cancel row (a real, wired cancellation -
          // see `cancelUpload` in use-document-upload-flow.ts) - this
          // generic hint is only needed for the short, non-abortable
          // `initiating`/`confirming` backend round trips either side of it.
          phase.kind === "uploading" ? null : <p className="media-busy-hint">{t("media.uploadInProgressHint")}</p>
        ) : (
          <div className="modal-actions">
            <button className="secondary-button" type="button" onClick={onClose}>
              {t("common.cancel")}
            </button>
            <button className="primary-button" type="submit" disabled={!file || phase.kind === "done"}>
              {t("media.uploadDocumentAction")}
            </button>
          </div>
        )}
      </form>
    </Modal>
  );
}

/**
 * The file picker + upload progress/error/status UI, factored out of
 * `UploadDocumentDialog` so the Add Lesson "upload new document" step can
 * reuse the exact same real upload experience inline, without a nested
 * modal-in-modal. Purely presentational over `useDocumentUploadFlow`'s
 * state - no upload logic lives here.
 */
export function DocumentUploadFields({ flow }: { flow: DocumentUploadFlow }) {
  const { t } = useI18n();
  const { file, fileError, phase, busy } = flow;

  return (
    <>
      <div className="field">
        <label htmlFor="document-file-input">{t("media.chooseFileAction")}</label>
        <input
          id="document-file-input"
          key={flow.resetKey}
          type="file"
          accept={DOCUMENT_ALLOWED_MIME_TYPES.join(",")}
          onChange={flow.handleFileChange}
          disabled={busy}
        />
        <p className="media-file-hint">
          {t("media.pdfOnlyHint")} {t("media.maxSizePrefix")} {formatFileSize(DOCUMENT_MAX_FILE_SIZE_BYTES)}
        </p>
        <p className="media-selected-file" aria-live="polite">
          {file ? `${file.name} · ${formatFileSize(file.size)}` : t("media.noFileSelected")}
        </p>
        {fileError ? (
          <p className="field-error" role="alert">
            {t(fileError)}
          </p>
        ) : null}
      </div>

      <div aria-live="polite" role="status" className="media-upload-status">
        {phase.kind === "initiating" ? <p>{t("media.uploadStateInitiating")}</p> : null}
        {phase.kind === "uploading" ? (
          <>
            <p>
              {t("media.uploadingPrefix")} {formatFileSize(phase.loaded)} / {formatFileSize(phase.total)}
              {phase.total > 0 ? ` (${Math.round((phase.loaded / phase.total) * 100)}%)` : ""}
            </p>
            {phase.total > 0 ? <progress className="media-upload-progress" value={phase.loaded} max={phase.total} /> : null}
          </>
        ) : null}
        {phase.kind === "confirming" ? <p>{t("media.uploadStateConfirming")}</p> : null}
        {phase.kind === "done" ? <p>{t("media.uploadSuccessDocument")}</p> : null}
      </div>

      {phase.kind === "uploading" ? (
        <div className="media-busy-row">
          <p className="media-busy-hint">{t("media.uploadInProgressHint")}</p>
          <button className="ghost-button compact" type="button" onClick={flow.cancelUpload}>
            {t("media.cancelUploadAction")}
          </button>
        </div>
      ) : null}

      {phase.kind === "cancelled" ? (
        <div className="media-cancelled-note" role="status">
          <p className="form-note">{t("media.uploadCancelledNote")}</p>
          <button className="secondary-button compact-action" type="button" onClick={flow.startOver}>
            {t("media.startOverAction")}
          </button>
        </div>
      ) : null}

      {phase.kind === "initiate-failed" ? (
        <div className="form-error" role="alert">
          <p>{isNetworkError(phase.error) ? t("shell.apiUnavailable") : t(resolveErrorMessageKey(phase.error, "media.errorSigningFailed"))}</p>
          <button className="secondary-button compact-action" type="button" onClick={flow.retryInitiate}>
            {t("shell.retry")}
          </button>
        </div>
      ) : null}

      {phase.kind === "put-failed" ? (
        <div className="form-error" role="alert">
          <p>
            {phase.error.kind === "network"
              ? t("media.errorPutNetwork")
              : isUploadCapabilityExpired(phase.intent.expiresAt, new Date())
                ? t("media.errorCapabilityExpired")
                : t("media.errorPutHttp")}
          </p>
          {isUploadCapabilityExpired(phase.intent.expiresAt, new Date()) ? (
            <button className="secondary-button compact-action" type="button" onClick={flow.startOver}>
              {t("media.startOverAction")}
            </button>
          ) : (
            <button className="secondary-button compact-action" type="button" onClick={flow.retryUpload}>
              {t("media.retryUploadAction")}
            </button>
          )}
        </div>
      ) : null}

      {phase.kind === "confirm-failed" ? (
        <div className="form-error" role="alert">
          <p>{isNetworkError(phase.error) ? t("shell.apiUnavailable") : t(resolveErrorMessageKey(phase.error, "media.errorConfirmGeneric"))}</p>
          <button className="secondary-button compact-action" type="button" onClick={flow.retryConfirm}>
            {t("media.retryConfirmAction")}
          </button>
        </div>
      ) : null}

      {phase.kind === "rejected" ? (
        <div className="form-error" role="alert">
          <p>
            {t("media.uploadFailed")} {t("media.errorVerificationFailed")}
          </p>
          <button className="secondary-button compact-action" type="button" onClick={flow.startOver}>
            {t("media.startOverAction")}
          </button>
        </div>
      ) : null}
    </>
  );
}
