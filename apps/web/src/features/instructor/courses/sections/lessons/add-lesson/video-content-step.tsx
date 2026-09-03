"use client";

import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { validateCourseInput } from "@/features/instructor/courses/validation";
import { VideoUploadFields } from "@/features/instructor/media/upload-video-dialog";
import { useVideoUploadFlow } from "@/features/instructor/media/use-video-upload-flow";
import { useI18n } from "@/lib/i18n/i18n";

/**
 * "Upload new video" side of the Add Lesson video content step. Reuses the
 * exact same real Bunny-Stream TUS upload implementation as the standalone
 * Media Library dialog (`useVideoUploadFlow`/`VideoUploadFields` in
 * `features/instructor/media`) - there is exactly one video upload
 * implementation in this codebase, embedded here rather than duplicated.
 *
 * The instructor is never sent to Media as part of this flow. Once the
 * upload intent resolves, a real `VideoAsset` row already exists
 * (`UPLOADING`) - "Continue" becomes available immediately so the Lesson
 * can be created while the video is still uploading/processing, per the
 * product requirement that a Lesson may exist before its content is READY.
 * Readiness/processing status is shown honestly, never faked.
 *
 * `onBusyChange` reports `flow.busy` (the provider resource creation call,
 * then the active TUS transfer) up to the Add Lesson dialog so it can block
 * accidental Escape/scrim dismissal and its own Back button while bytes are
 * genuinely in flight - see create-lesson-dialog.tsx. Bunny's TUS endpoint
 * only supports pausing/resuming an upload (`handle.abort()` in
 * video-tus.ts), never a true cancel-and-delete, so this deliberately does
 * not offer a "Cancel" action here - inventing one would either lie about
 * what it does or silently abandon an asset the backend already persisted.
 * Preventing dismissal until the transfer reaches a safe state (`queued`,
 * a failure, or the instructor's own explicit "Continue with this video"
 * once bytes are captured) is the correct, smallest fix.
 */
export function VideoContentStep({
  tenantId,
  onSelected,
  onBusyChange,
}: {
  tenantId: string;
  onSelected: (videoAssetId: string) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const { t } = useI18n();
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [titleError, setTitleError] = useState<"required" | "tooLong" | null>(null);
  const flow = useVideoUploadFlow(tenantId, () => undefined);
  const { phase, busy, hasCapturedAsset } = flow;
  const capturedVideoAssetId = phase.kind === "uploading" || phase.kind === "queued" ? phase.intent.videoAssetId : null;

  useEffect(() => {
    onBusyChange(busy);
    // Belt-and-suspenders: also clear on unmount regardless of `busy` at
    // that instant, so this step can never leave the dialog stuck blocked
    // if it goes away for any reason.
    return () => onBusyChange(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy]);

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
    <div className="add-lesson-create-panel">
      <form className="auth-form" onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="add-lesson-video-title">{t("media.videoTitleLabel")}</label>
          <input
            id="add-lesson-video-title"
            type="text"
            maxLength={240}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            disabled={busy}
            aria-invalid={titleError ? "true" : "false"}
            aria-describedby={titleError ? "add-lesson-video-title-error" : undefined}
          />
          {titleError ? (
            <p className="field-error" id="add-lesson-video-title-error">
              {titleError === "required" ? t("courses.titleRequired") : t("courses.titleTooLong")}
            </p>
          ) : null}
        </div>

        <VideoUploadFields flow={flow} file={file} fileError={fileError} title={title} onFileChange={handleFileChange} onStartOver={startOver} />

        {busy && !hasCapturedAsset ? <p className="media-busy-hint">{t("media.uploadInProgressHint")}</p> : null}

        {phase.kind === "idle" || phase.kind === "initiate-failed" ? (
          <div className="modal-actions">
            <button className="primary-button" type="submit" disabled={busy}>
              {t("media.uploadVideoAction")}
            </button>
          </div>
        ) : null}
      </form>

      {hasCapturedAsset && capturedVideoAssetId ? (
        <div className="add-lesson-continue-row">
          <p className="form-note">{t("lessons.videoProcessingContinueNote")}</p>
          <button className="primary-button compact-action" type="button" onClick={() => onSelected(capturedVideoAssetId)}>
            {t("lessons.continueWithThisVideoAction")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
