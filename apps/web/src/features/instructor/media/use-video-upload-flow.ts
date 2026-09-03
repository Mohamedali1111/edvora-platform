"use client";

import { useState } from "react";
import { getAuthService } from "@/lib/api/session";
import type { VideoUploadIntent } from "@/lib/api/types";
import { createVideoUploadIntent } from "./media-service";
import { isUploadCapabilityExpired } from "./document-upload";
import { createTusUpload, type TusUploadHandle } from "./video-tus";

/**
 * Reaching `queued` means only that bytes finished uploading to Bunny's TUS
 * endpoint - never that the video is `READY`. Bunny's webhook-driven
 * processing (see docs/MEDIA.md) is a separate, later state this flow
 * cannot observe; callers hand control back to whatever list/polling
 * eventually shows PROCESSING -> READY (`media-service.ts#useVideosList`).
 *
 * `intent` travels with `uploading`/`upload-failed` (not just `handle`) so
 * a retry can check `intent.expiresAt` against the backend-issued TTL
 * before reusing the same Bunny TUS authorization headers - see
 * `retryUpload` below. Critically, `intent.videoAssetId` is already a real,
 * persisted `VideoAsset` row (`UPLOADING`) from the moment `uploading` is
 * reached - callers (the Add Lesson flow in particular) may attach/select
 * it immediately and let a Lesson exist while the upload/processing is
 * still in progress, per the product's "create in context" requirement;
 * this hook never fakes `READY`.
 */
export type VideoUploadPhase =
  | { kind: "idle" }
  | { kind: "initiating" }
  | { kind: "initiate-failed"; error: unknown }
  | { kind: "uploading"; intent: VideoUploadIntent; handle: TusUploadHandle; loaded: number; total: number }
  | { kind: "upload-failed"; intent: VideoUploadIntent; handle: TusUploadHandle; error: Error }
  | { kind: "queued"; intent: VideoUploadIntent };

const BUSY_PHASES = new Set(["initiating", "uploading"]);

/**
 * The real Bunny-Stream-backed video upload flow, extracted so it has
 * exactly one implementation shared by the standalone Media Library dialog
 * (`UploadVideoDialog`) and the in-context "upload new video" step of the
 * Add Lesson flow (`add-lesson/video-content-step.tsx`). Implements
 * initiate (creates the real provider video resource + a short-lived TUS
 * capability) -> direct browser-to-Bunny TUS upload via tus-js-client. No
 * Bunny API key/webhook secret is ever available here - only the
 * capability `createVideoUploadIntent` returned (see video-tus.ts, which
 * also disables tus-js-client's default browser localStorage persistence
 * for this exact reason).
 */
export function useVideoUploadFlow(tenantId: string, onUploaded: (videoAssetId: string) => void) {
  const [phase, setPhase] = useState<VideoUploadPhase>({ kind: "idle" });
  // Matches the original dialog's behavior: the file/title fields stay
  // disabled for the whole in-progress transfer, not just while creating
  // the provider resource - re-selecting a different file mid-transfer
  // would abandon an in-flight TUS upload silently. This is independent of
  // `hasCapturedAsset` below, which is what actually lets a caller (the Add
  // Lesson flow) proceed to the next step early.
  const busy = BUSY_PHASES.has(phase.kind);
  // True from the moment the upload intent resolves and bytes are actively
  // (or successfully) transferring - a real, persisted VideoAsset row
  // already exists at that point (see the module docstring). Deliberately
  // excludes `upload-failed`: the row exists, but with no bytes reliably in
  // flight there is nothing useful to attach yet, so the Add Lesson flow
  // should require a successful retry (or a fresh upload) before it can
  // proceed, not silently attach a stalled asset. The Add Lesson flow uses
  // this (not `!busy`) to enable "Continue" while upload/processing is
  // still in progress, per the product requirement that a Lesson may exist
  // while its video is still processing.
  const hasCapturedAsset = phase.kind === "uploading" || phase.kind === "queued";

  function beginUpload(targetFile: File, targetTitle: string) {
    setPhase({ kind: "initiating" });

    createVideoUploadIntent(getAuthService().getClient(), tenantId, { title: targetTitle })
      .then((intent) => {
        const handle = createTusUpload(intent, targetFile, {
          onProgress: (loaded, total) => {
            setPhase((current) => (current.kind === "uploading" ? { ...current, loaded, total } : current));
          },
          onSuccess: () => {
            setPhase({ kind: "queued", intent });
            // A second, harmless/idempotent nudge now that bytes are fully
            // sent - the same VideoAsset id, so a caller (e.g. the
            // standalone Media Library dialog) that only cares about "the
            // list may need a refresh now" still gets that exact signal at
            // upload completion too, not only at intent creation.
            onUploaded(intent.videoAssetId);
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
        // The VideoAsset row already exists (UPLOADING) the instant the
        // intent was issued - callers may attach/select it now, before TUS
        // bytes finish sending. Never awaited/blocking: the caller decides
        // whether to wait for `queued` or proceed immediately.
        onUploaded(intent.videoAssetId);
      })
      .catch((error: unknown) => {
        setPhase({ kind: "initiate-failed", error });
      });
  }

  function retryUpload() {
    if (phase.kind !== "upload-failed") {
      return;
    }

    if (isUploadCapabilityExpired(phase.intent.expiresAt, new Date())) {
      return;
    }

    const { intent, handle } = phase;
    setPhase({ kind: "uploading", intent, handle, loaded: 0, total: 0 });
    handle.start();
  }

  function retryInitiate(file: File | null, title: string) {
    if (phase.kind !== "initiate-failed" || !file) {
      return;
    }

    beginUpload(file, title);
  }

  function startOver() {
    setPhase({ kind: "idle" });
  }

  return { phase, busy, hasCapturedAsset, beginUpload, retryUpload, retryInitiate, startOver };
}

export type VideoUploadFlow = ReturnType<typeof useVideoUploadFlow>;
