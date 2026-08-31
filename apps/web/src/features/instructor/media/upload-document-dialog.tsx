"use client";

import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { Modal } from "@/features/instructor/students/dialog";
import { getAuthService } from "@/lib/api/session";
import { useI18n } from "@/lib/i18n/i18n";
import type { TranslationKey } from "@/lib/i18n/translations";
import type { DocumentUploadIntent } from "@/lib/api/types";
import { confirmDocumentUpload, createDocumentUploadIntent } from "./media-service";
import { formatFileSize } from "./format";
import {
  DOCUMENT_ALLOWED_MIME_TYPES,
  DOCUMENT_MAX_FILE_SIZE_BYTES,
  isUploadCapabilityExpired,
  uploadDocumentBytes,
  validateDocumentFile,
  type DocumentUploadTransportError,
} from "./document-upload";
import { isNetworkError, resolveErrorMessageKey } from "./error-mapping";

/**
 * The dialog's own upload lifecycle. Distinct from `AssetProcessingStatus` -
 * this tracks *this browser tab's* attempt to move bytes from the file
 * picker to a verified `DocumentAsset`, including transport-level phases
 * (direct R2 PUT, confirmation) the backend's asset-level status alone
 * doesn't describe. `intent` is only ever the exact capability the backend
 * issued - never constructed or guessed client-side.
 */
type Phase =
  | { kind: "idle" }
  | { kind: "initiating" }
  | { kind: "initiate-failed"; error: unknown }
  | { kind: "uploading"; intent: DocumentUploadIntent; loaded: number; total: number }
  | { kind: "put-failed"; intent: DocumentUploadIntent; error: DocumentUploadTransportError }
  | { kind: "confirming"; intent: DocumentUploadIntent }
  | { kind: "confirm-failed"; intent: DocumentUploadIntent; error: unknown }
  | { kind: "rejected" }
  | { kind: "done" };

const BUSY_PHASES = new Set(["initiating", "uploading", "confirming"]);

/**
 * Implements the real R2-backed flow: initiate -> direct browser PUT to R2
 * -> confirm. Never reports success until `confirmDocumentUpload` returns
 * `READY`; never invents an asset state or a cleanup call the backend
 * doesn't expose (see docs/MEDIA.md's confirmation/idempotency guarantees,
 * which this dialog's retry actions rely on directly).
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
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<TranslationKey | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const busy = BUSY_PHASES.has(phase.kind);

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] ?? null;

    if (!selected) {
      setFile(null);
      setFileError(null);
      return;
    }

    const validationError = validateDocumentFile(selected);

    if (validationError === "EMPTY") {
      setFile(null);
      setFileError("media.errorFileEmpty");
    } else if (validationError === "INVALID_TYPE") {
      setFile(null);
      setFileError("media.errorFileInvalidType");
    } else if (validationError === "TOO_LARGE") {
      setFile(null);
      setFileError("media.errorFileTooLarge");
    } else {
      setFile(selected);
      setFileError(null);
    }
  }

  async function runUpload(targetFile: File) {
    setPhase({ kind: "initiating" });

    let intent: DocumentUploadIntent;

    try {
      intent = await createDocumentUploadIntent(getAuthService().getClient(), tenantId, {
        fileName: targetFile.name,
        mimeType: targetFile.type,
        fileSizeBytes: targetFile.size,
      });
    } catch (error) {
      setPhase({ kind: "initiate-failed", error });
      return;
    }

    await putAndConfirm(targetFile, intent);
  }

  async function putAndConfirm(targetFile: File, intent: DocumentUploadIntent) {
    setPhase({ kind: "uploading", intent, loaded: 0, total: targetFile.size });

    try {
      await uploadDocumentBytes(intent.uploadUrl, intent.headers, targetFile, (loaded, total) => {
        setPhase((current) => (current.kind === "uploading" ? { ...current, loaded, total } : current));
      });
    } catch (error) {
      setPhase({ kind: "put-failed", intent, error: error as DocumentUploadTransportError });
      return;
    }

    await runConfirm(intent);
  }

  async function runConfirm(intent: DocumentUploadIntent) {
    setPhase({ kind: "confirming", intent });

    try {
      const confirmation = await confirmDocumentUpload(getAuthService().getClient(), tenantId, intent.documentAssetId);

      if (confirmation.processingStatus === "READY") {
        setPhase({ kind: "done" });
        onUploaded();
      } else {
        setPhase({ kind: "rejected" });
      }
    } catch (error) {
      setPhase({ kind: "confirm-failed", intent, error });
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (busy || !file) {
      if (!file) {
        setFileError("media.errorFileEmpty");
      }
      return;
    }

    await runUpload(file);
  }

  function retryUpload() {
    if (phase.kind !== "put-failed" || !file) {
      return;
    }

    if (isUploadCapabilityExpired(phase.intent.expiresAt, new Date())) {
      return;
    }

    void putAndConfirm(file, phase.intent);
  }

  function retryConfirm() {
    if (phase.kind !== "confirm-failed") {
      return;
    }

    void runConfirm(phase.intent);
  }

  function startOver() {
    setFile(null);
    setFileError(null);
    setPhase({ kind: "idle" });
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  return (
    <Modal titleId="upload-document-title" onClose={busy ? () => undefined : onClose}>
      <form className="auth-form" onSubmit={submit} noValidate>
        <h2 id="upload-document-title">{t("media.uploadDialogTitleDocument")}</h2>

        <div className="field">
          <label htmlFor="document-file-input">{t("media.chooseFileAction")}</label>
          <input
            id="document-file-input"
            ref={fileInputRef}
            type="file"
            accept={DOCUMENT_ALLOWED_MIME_TYPES.join(",")}
            onChange={handleFileChange}
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

        {phase.kind === "initiate-failed" ? (
          <div className="form-error" role="alert">
            <p>{isNetworkError(phase.error) ? t("shell.apiUnavailable") : t(resolveErrorMessageKey(phase.error, "media.errorSigningFailed"))}</p>
            <button className="secondary-button compact-action" type="button" onClick={() => file && void runUpload(file)}>
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
              <button className="secondary-button compact-action" type="button" onClick={startOver}>
                {t("media.startOverAction")}
              </button>
            ) : (
              <button className="secondary-button compact-action" type="button" onClick={retryUpload}>
                {t("media.retryUploadAction")}
              </button>
            )}
          </div>
        ) : null}

        {phase.kind === "confirm-failed" ? (
          <div className="form-error" role="alert">
            <p>{isNetworkError(phase.error) ? t("shell.apiUnavailable") : t(resolveErrorMessageKey(phase.error, "media.errorConfirmGeneric"))}</p>
            <button className="secondary-button compact-action" type="button" onClick={retryConfirm}>
              {t("media.retryConfirmAction")}
            </button>
          </div>
        ) : null}

        {phase.kind === "rejected" ? (
          <div className="form-error" role="alert">
            <p>
              {t("media.uploadFailed")} {t("media.errorVerificationFailed")}
            </p>
            <button className="secondary-button compact-action" type="button" onClick={startOver}>
              {t("media.startOverAction")}
            </button>
          </div>
        ) : null}

        {busy ? (
          <p className="media-busy-hint">{t("media.uploadInProgressHint")}</p>
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
