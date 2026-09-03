"use client";

import { useEffect, type FormEvent } from "react";
import { DocumentUploadFields } from "@/features/instructor/media/upload-document-dialog";
import { useDocumentUploadFlow } from "@/features/instructor/media/use-document-upload-flow";
import { useI18n } from "@/lib/i18n/i18n";

/**
 * "Upload PDF" side of the Add Lesson document content step. Reuses the
 * exact same real R2-backed upload implementation (with the Part 5
 * false-failure fix) as the standalone Media Library dialog
 * (`useDocumentUploadFlow`/`DocumentUploadFields`) - embedded here rather
 * than duplicated. Documents are synchronously confirmable (no
 * webhook-driven async processing, unlike Video - see
 * media/documents-panel.tsx), so a completed upload advances this flow to
 * the Lesson details step automatically rather than needing an extra
 * "Continue" click.
 *
 * `onBusyChange` reports `flow.busy` up to the Add Lesson dialog so it can
 * block accidental Escape/scrim dismissal and its own Back button while the
 * upload is genuinely in flight - see create-lesson-dialog.tsx. Unlike
 * Video, a real, explicit Cancel is also offered here (see
 * `DocumentUploadFields`'s "uploading" row): the direct-to-R2 `PUT` this
 * flow performs already supports true cancellation via `AbortController`
 * (`cancelUpload` in use-document-upload-flow.ts), so once cancelled,
 * `busy` clears on its own and dismissal is available again immediately.
 */
export function DocumentContentStep({
  tenantId,
  onSelected,
  onBusyChange,
}: {
  tenantId: string;
  onSelected: (documentAssetId: string) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const { t } = useI18n();
  const flow = useDocumentUploadFlow(tenantId, () => undefined);
  const { phase, busy, file } = flow;

  useEffect(() => {
    if (phase.kind === "done") {
      onSelected(phase.documentAssetId);
    }
    // Intentionally fires only on a phase transition into "done" - `onSelected`
    // is not a dependency so a parent re-render never re-fires this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  useEffect(() => {
    onBusyChange(busy);
    // Belt-and-suspenders: also clear on unmount regardless of `busy` at
    // that instant, so this step can never leave the dialog stuck blocked
    // if it goes away for any reason.
    return () => onBusyChange(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    flow.startUpload();
  }

  return (
    <form className="auth-form" onSubmit={submit} noValidate>
      <DocumentUploadFields flow={flow} />

      {phase.kind === "idle" || phase.kind === "initiate-failed" ? (
        <div className="modal-actions">
          <button className="primary-button" type="submit" disabled={!file || busy}>
            {t("media.uploadDocumentAction")}
          </button>
        </div>
      ) : null}
    </form>
  );
}
