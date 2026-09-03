"use client";

import { useRef, useState, type ChangeEvent } from "react";
import { getAuthService } from "@/lib/api/session";
import type { TranslationKey } from "@/lib/i18n/translations";
import type { DocumentUploadIntent } from "@/lib/api/types";
import { confirmDocumentUpload, createDocumentUploadIntent } from "./media-service";
import {
  isAmbiguousPutFailure,
  isUploadCapabilityExpired,
  isUserCancelledPut,
  uploadDocumentBytes,
  validateDocumentFile,
  type DocumentUploadTransportError,
} from "./document-upload";

/**
 * This browser tab's own upload lifecycle. Distinct from `AssetProcessingStatus` -
 * this tracks the attempt to move bytes from the file picker to a verified
 * `DocumentAsset`, including transport-level phases (direct R2 PUT,
 * confirmation) the backend's asset-level status alone doesn't describe.
 * `intent` is only ever the exact capability the backend issued - never
 * constructed or guessed client-side.
 */
export type DocumentUploadPhase =
  | { kind: "idle" }
  | { kind: "initiating" }
  | { kind: "initiate-failed"; error: unknown }
  | { kind: "uploading"; intent: DocumentUploadIntent; loaded: number; total: number }
  | { kind: "put-failed"; intent: DocumentUploadIntent; error: DocumentUploadTransportError }
  | { kind: "cancelled" }
  | { kind: "confirming"; intent: DocumentUploadIntent }
  | { kind: "confirm-failed"; intent: DocumentUploadIntent; error: unknown }
  | { kind: "rejected" }
  | { kind: "done"; documentAssetId: string };

const BUSY_PHASES = new Set(["initiating", "uploading", "confirming"]);

/**
 * The real R2-backed document upload flow, extracted so it has exactly one
 * implementation shared by the standalone Media Library dialog
 * (`UploadDocumentDialog`) and the in-context "upload new document" step of
 * the Add Lesson flow (`add-lesson/document-content-step.tsx`) - per the
 * product requirement that Add Lesson must never duplicate the real upload
 * implementation. initiate -> direct browser PUT to R2 -> confirm. Never
 * reports success until `confirmDocumentUpload` returns `READY`, and never
 * reports a *definitive* failure on evidence that doesn't actually prove
 * one: an ambiguous PUT transport error reconciles against authoritative
 * backend state via the same idempotent confirm call before any failure UI
 * is shown (see `putAndConfirm` below and docs/MEDIA.md's confirmation/
 * idempotency guarantees).
 */
export function useDocumentUploadFlow(tenantId: string, onUploaded: (documentAssetId: string) => void) {
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<TranslationKey | null>(null);
  const [phase, setPhase] = useState<DocumentUploadPhase>({ kind: "idle" });
  // Remounts the file `<input>` on `startOver()` (see below) so the browser
  // clears its selected file - deliberately not a DOM ref returned from
  // this hook: a ref threaded through a hook's return object like this one
  // (functions alongside state) trips the react-hooks/refs lint rule, which
  // can't prove property access on the returned object is ref-safe. A
  // remount key is also simpler - no imperative DOM access at all.
  const [resetKey, setResetKey] = useState(0);
  const busy = BUSY_PHASES.has(phase.kind);
  // Local to this hook, never returned/threaded through the returned object
  // (that pattern is what previously tripped the react-hooks/refs lint
  // rule - see `resetKey`'s docstring above). Holds the in-flight PUT's
  // real cancellation handle, wired into `uploadDocumentBytes`'s existing
  // `signal` parameter below - not a new capability, just the first caller
  // to actually use one this transport helper already supported.
  const abortControllerRef = useRef<AbortController | null>(null);

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

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      await uploadDocumentBytes(
        intent.uploadUrl,
        intent.headers,
        targetFile,
        (loaded, total) => {
          setPhase((current) => (current.kind === "uploading" ? { ...current, loaded, total } : current));
        },
        controller.signal,
      );
    } catch (error) {
      const transportError = error as DocumentUploadTransportError;

      if (isUserCancelledPut(transportError)) {
        // A real, deliberate instructor cancellation - not ambiguous like a
        // network error, so this is reported honestly as "cancelled", never
        // as a failure and never reconciled (the instructor's own intent is
        // already known). The R2 temp object this PUT was sending to is
        // simply never confirmed/promoted - matching this codebase's
        // already-documented, already-accepted policy that an abandoned
        // `UPLOADING` DocumentAsset requires no special cleanup here.
        setPhase({ kind: "cancelled" });
        return;
      }

      if (isAmbiguousPutFailure(transportError)) {
        // The browser reported a transport failure, but that does not prove
        // the bytes never reached R2 - e.g. a connection reset right after
        // the request body finished sending. Never tell the instructor the
        // upload definitively failed on this evidence alone: reconcile
        // against authoritative backend state using the exact same
        // idempotent confirm call the normal happy path (and an explicit
        // confirm retry) already use. If R2 really does have the object,
        // this promotes it to READY and reports success; if it genuinely
        // isn't there, confirmation fails honestly and recoverably instead.
        await runConfirm(intent);
        return;
      }

      // A real non-2xx from R2, or the instructor/dialog cancelled the
      // request - both unambiguous, so the existing definitive-failure UI
      // (retry the same PUT) is correct here.
      setPhase({ kind: "put-failed", intent, error: transportError });
      return;
    }

    await runConfirm(intent);
  }

  async function runConfirm(intent: DocumentUploadIntent) {
    setPhase({ kind: "confirming", intent });

    try {
      const confirmation = await confirmDocumentUpload(getAuthService().getClient(), tenantId, intent.documentAssetId);

      if (confirmation.processingStatus === "READY") {
        setPhase({ kind: "done", documentAssetId: intent.documentAssetId });
        onUploaded(intent.documentAssetId);
      } else {
        setPhase({ kind: "rejected" });
      }
    } catch (error) {
      setPhase({ kind: "confirm-failed", intent, error });
    }
  }

  function startUpload() {
    if (busy || !file) {
      if (!file) {
        setFileError("media.errorFileEmpty");
      }
      return;
    }

    void runUpload(file);
  }

  function retryInitiate() {
    if (phase.kind !== "initiate-failed" || !file) {
      return;
    }

    void runUpload(file);
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
    setResetKey((value) => value + 1);
  }

  /**
   * The one genuine, well-defined cancellation this flow supports: while
   * bytes are actively transferring to R2, stop that specific request via
   * the `AbortController` already wired into it. Deliberately a no-op
   * outside `uploading` (nothing in-flight to stop - `initiating`/
   * `confirming` are short, non-abortable backend round trips, not a raw
   * transport this hook controls). This never deletes anything remote and
   * never invents provider-level cancellation; it is the same "stop this
   * XHR" capability `uploadDocumentBytes` already exposed, just now used.
   */
  function cancelUpload() {
    if (phase.kind !== "uploading") {
      return;
    }

    abortControllerRef.current?.abort();
  }

  return {
    file,
    fileError,
    phase,
    busy,
    resetKey,
    handleFileChange,
    startUpload,
    retryInitiate,
    retryUpload,
    retryConfirm,
    cancelUpload,
    startOver,
  };
}

export type DocumentUploadFlow = ReturnType<typeof useDocumentUploadFlow>;
