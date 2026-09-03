"use client";

import { useState, type ChangeEvent, type FormEvent } from "react";
import { Modal } from "@/features/instructor/students/dialog";
import { validateCourseInput } from "@/features/instructor/courses/validation";
import { useI18n } from "@/lib/i18n/i18n";
import { formatFileSize } from "./format";
import { isUploadCapabilityExpired } from "./document-upload";
import { useVideoUploadFlow, type VideoUploadFlow } from "./use-video-upload-flow";
import { isNetworkError, resolveErrorMessageKey } from "./error-mapping";

/**
 * Implements the real Bunny-Stream-backed flow via `useVideoUploadFlow` -
 * this component owns only the standalone Media Library modal chrome (title
 * field + modal actions); `VideoUploadFields` below is the shared
 * presentational body also reused, without a `Modal` wrapper, by the
 * in-context "upload new video" step of the Add Lesson flow.
 */
export function UploadVideoDialog({
  tenantId,
  onClose,
  onUploaded,
}: {
  tenantId: string;
  onClose: () => void;
  onUploaded: () => void;
}) {
  const { t } = useI18n();
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [titleError, setTitleError] = useState<"required" | "tooLong" | null>(null);
  const flow = useVideoUploadFlow(tenantId, onUploaded);
  const { phase, busy } = flow;

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] ?? null;
    setFile(selected);
    setFileError(selected ? null : fileError);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (busy) {
      return;
    }

    const errors = validateCourseInput(title, "");
    setTitleError(errors.title ?? null);
    setFileError(file ? null : "media.errorFileEmpty");

    if (errors.title || !file) {
      return;
    }

    flow.beginUpload(file, title.trim());
  }

  function startOver() {
    setFile(null);
    setFileError(null);
    setTitle("");
    setTitleError(null);
    flow.startOver();
  }

  return (
    <Modal titleId="upload-video-title" onClose={busy ? () => undefined : onClose}>
      <form className="auth-form" onSubmit={submit} noValidate>
        <h2 id="upload-video-title">{t("media.uploadDialogTitleVideo")}</h2>

        <div className="field">
          <label htmlFor="video-title-input">{t("media.videoTitleLabel")}</label>
          <input
            id="video-title-input"
            type="text"
            maxLength={240}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            disabled={busy}
            aria-invalid={titleError ? "true" : "false"}
            aria-describedby={titleError ? "video-title-error" : undefined}
          />
          {titleError ? (
            <p className="field-error" id="video-title-error">
              {titleError === "required" ? t("courses.titleRequired") : t("courses.titleTooLong")}
            </p>
          ) : null}
        </div>

        <VideoUploadFields flow={flow} file={file} fileError={fileError} title={title} onFileChange={handleFileChange} onStartOver={startOver} />

        {busy ? (
          <p className="media-busy-hint">{t("media.uploadInProgressHint")}</p>
        ) : (
          <div className="modal-actions">
            <button className="secondary-button" type="button" onClick={onClose}>
              {t("common.cancel")}
            </button>
            <button className="primary-button" type="submit" disabled={phase.kind === "queued" || phase.kind === "uploading"}>
              {t("media.uploadVideoAction")}
            </button>
          </div>
        )}
      </form>
    </Modal>
  );
}

/**
 * File field + upload progress/error/status UI, factored out of
 * `UploadVideoDialog` so the Add Lesson "upload new video" step can reuse
 * the exact same real upload experience inline. Purely presentational over
 * `useVideoUploadFlow`'s state plus the caller's own file-selection state
 * (title/file stay with the caller since Add Lesson's title field differs
 * from the standalone dialog's).
 */
export function VideoUploadFields({
  flow,
  file,
  fileError,
  title,
  onFileChange,
  onStartOver,
}: {
  flow: VideoUploadFlow;
  file: File | null;
  fileError: string | null;
  title: string;
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onStartOver: () => void;
}) {
  const { t } = useI18n();
  const { phase, busy } = flow;

  return (
    <>
      <div className="field">
        <label htmlFor="video-file-input">{t("media.chooseFileAction")}</label>
        <input id="video-file-input" type="file" accept="video/*" onChange={onFileChange} disabled={busy} />
        <p className="media-selected-file" aria-live="polite">
          {file ? `${file.name} · ${formatFileSize(file.size)}` : t("media.noFileSelected")}
        </p>
        {fileError ? (
          <p className="field-error" role="alert">
            {t("media.errorFileEmpty")}
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
        {phase.kind === "queued" ? <p>{t("media.uploadSuccessVideoQueued")}</p> : null}
      </div>

      {phase.kind === "initiate-failed" ? (
        <div className="form-error" role="alert">
          <p>{isNetworkError(phase.error) ? t("shell.apiUnavailable") : t(resolveErrorMessageKey(phase.error, "media.errorSigningFailed"))}</p>
          <button className="secondary-button compact-action" type="button" onClick={() => flow.retryInitiate(file, title.trim())}>
            {t("shell.retry")}
          </button>
        </div>
      ) : null}

      {phase.kind === "upload-failed" ? (
        <div className="form-error" role="alert">
          <p>{isUploadCapabilityExpired(phase.intent.expiresAt, new Date()) ? t("media.errorCapabilityExpired") : t("media.errorPutNetwork")}</p>
          {isUploadCapabilityExpired(phase.intent.expiresAt, new Date()) ? (
            <button className="secondary-button compact-action" type="button" onClick={onStartOver}>
              {t("media.startOverAction")}
            </button>
          ) : (
            <button className="secondary-button compact-action" type="button" onClick={flow.retryUpload}>
              {t("media.retryUploadAction")}
            </button>
          )}
        </div>
      ) : null}
    </>
  );
}
