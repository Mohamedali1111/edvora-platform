"use client";

import { useState, type ChangeEvent, type FormEvent } from "react";
import { Modal } from "@/features/instructor/students/dialog";
import { validateCourseInput } from "@/features/instructor/courses/validation";
import { getAuthService } from "@/lib/api/session";
import { useI18n } from "@/lib/i18n/i18n";
import type { VideoUploadIntent } from "@/lib/api/types";
import { createVideoUploadIntent } from "./media-service";
import { formatFileSize } from "./format";
import { isUploadCapabilityExpired } from "./document-upload";
import { createTusUpload, type TusUploadHandle } from "./video-tus";
import { isNetworkError, resolveErrorMessageKey } from "./error-mapping";

/**
 * Reaching `queued` means only that bytes finished uploading to Bunny's TUS
 * endpoint - never that the video is `READY`. Bunny's webhook-driven
 * processing (see docs/MEDIA.md) is a separate, later state this dialog
 * cannot observe; `onUploaded` hands control back to `VideosPanel`, whose
 * own list/polling is what eventually shows PROCESSING -> READY.
 *
 * `intent` travels with `uploading`/`upload-failed` (not just `handle`) so
 * a retry can check `intent.expiresAt` against the backend-issued TTL
 * before reusing the same Bunny TUS authorization headers - see
 * `retryUpload` below.
 */
type Phase =
  | { kind: "idle" }
  | { kind: "initiating" }
  | { kind: "initiate-failed"; error: unknown }
  | { kind: "uploading"; intent: VideoUploadIntent; handle: TusUploadHandle; loaded: number; total: number }
  | { kind: "upload-failed"; intent: VideoUploadIntent; handle: TusUploadHandle; error: Error }
  | { kind: "queued" };

const BUSY_PHASES = new Set(["initiating", "uploading"]);

/**
 * Implements the real Bunny-Stream-backed flow: initiate (creates the real
 * provider video resource + a short-lived TUS capability) -> direct
 * browser-to-Bunny TUS upload via tus-js-client. No Bunny API key/webhook
 * secret is ever available to this dialog - only the capability
 * `createVideoUploadIntent` returned (see video-tus.ts, which also
 * disables tus-js-client's default browser localStorage persistence for
 * this exact reason - the capability is intentionally single-session only).
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
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const busy = BUSY_PHASES.has(phase.kind);

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] ?? null;
    setFile(selected);
    setFileError(selected ? null : fileError);
  }

  function beginUpload(targetFile: File, targetTitle: string) {
    setPhase({ kind: "initiating" });

    createVideoUploadIntent(getAuthService().getClient(), tenantId, { title: targetTitle })
      .then((intent) => {
        const handle = createTusUpload(intent, targetFile, {
          onProgress: (loaded, total) => {
            setPhase((current) => (current.kind === "uploading" ? { ...current, loaded, total } : current));
          },
          onSuccess: () => {
            setPhase({ kind: "queued" });
            onUploaded();
          },
          onError: (error) => {
            setPhase((current) =>
              current.kind === "uploading" || current.kind === "upload-failed"
                ? { kind: "upload-failed", intent: current.intent, handle: current.handle, error }
                : current,
            );
          },
        });

        setPhase({ kind: "uploading", intent, handle, loaded: 0, total: targetFile.size });
        handle.start();
      })
      .catch((error: unknown) => {
        setPhase({ kind: "initiate-failed", error });
      });
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

    beginUpload(file, title.trim());
  }

  /**
   * The backend-issued Bunny TUS authorization is immutable and
   * time-limited (`intent.expiresAt`) - once it has expired, retrying
   * against the same `handle` can only keep failing against a signature
   * Bunny will reject, so this refuses to retry and requires a brand new
   * upload intent instead (via `startOver` -> re-submitting the form).
   * While still valid, retrying resumes the same tus-js-client `Upload`
   * instance in place, which is the normal in-memory, current-session-only
   * retry this feature supports - no cross-reload resumption is attempted
   * or persisted (see video-tus.ts).
   */
  function retryUpload() {
    if (phase.kind !== "upload-failed") {
      return;
    }

    if (isUploadCapabilityExpired(phase.intent.expiresAt, new Date())) {
      return;
    }

    const { intent, handle } = phase;
    setPhase({ kind: "uploading", intent, handle, loaded: 0, total: file?.size ?? 0 });
    handle.start();
  }

  function retryInitiate() {
    if (phase.kind !== "initiate-failed" || !file) {
      return;
    }

    beginUpload(file, title.trim());
  }

  function startOver() {
    setFile(null);
    setFileError(null);
    setTitle("");
    setTitleError(null);
    setPhase({ kind: "idle" });
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

        <div className="field">
          <label htmlFor="video-file-input">{t("media.chooseFileAction")}</label>
          <input id="video-file-input" type="file" accept="video/*" onChange={handleFileChange} disabled={busy} />
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
            <button className="secondary-button compact-action" type="button" onClick={retryInitiate}>
              {t("shell.retry")}
            </button>
          </div>
        ) : null}

        {phase.kind === "upload-failed" ? (
          <div className="form-error" role="alert">
            <p>{isUploadCapabilityExpired(phase.intent.expiresAt, new Date()) ? t("media.errorCapabilityExpired") : t("media.errorPutNetwork")}</p>
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

        {busy ? (
          <p className="media-busy-hint">{t("media.uploadInProgressHint")}</p>
        ) : (
          <div className="modal-actions">
            <button className="secondary-button" type="button" onClick={onClose}>
              {t("common.cancel")}
            </button>
            <button className="primary-button" type="submit" disabled={phase.kind === "queued"}>
              {t("media.uploadVideoAction")}
            </button>
          </div>
        )}
      </form>
    </Modal>
  );
}
