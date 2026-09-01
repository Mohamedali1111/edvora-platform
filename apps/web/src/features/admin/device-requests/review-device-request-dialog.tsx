"use client";

import { useRef, useState } from "react";
import { getAuthService } from "@/lib/api/session";
import { useI18n } from "@/lib/i18n/i18n";
import type { DeviceChangeRequestSummary } from "@/lib/api/types";
import { Modal } from "../dialog";
import { formatDateTime } from "../format";
import { isNetworkError, isStaleRequestError, resolveErrorMessageKey } from "../error-mapping";
import { approveDeviceChangeRequest, rejectDeviceChangeRequest } from "./device-requests-service";

export type ReviewAction = "approve" | "reject";

/**
 * The one consequential-action dialog for this milestone: approve or reject
 * a pending device-change request. Backend stays fully authoritative -
 * there is no optimistic local approval/rejection here. A duplicate-submit
 * guard (ref, not just state) prevents a double POST from a fast double
 * click; on success the caller always does a real refetch of the pending
 * list (never a local status edit) - see DeviceRequestsList.onResolved.
 * `DEVICE_CHANGE_REQUEST_ALREADY_RESOLVED`/`_NOT_FOUND` (another admin
 * already acted, or the request disappeared) are treated as "go refresh the
 * list", not as a retryable form error, since this exact row is no longer
 * actionable.
 */
export function ReviewDeviceRequestDialog({
  action,
  request,
  onClose,
  onResolved,
  onStale,
}: {
  action: ReviewAction;
  request: DeviceChangeRequestSummary;
  onClose: () => void;
  onResolved: (action: ReviewAction) => void;
  onStale: () => void;
}) {
  const { t } = useI18n();
  const [reviewNote, setReviewNote] = useState("");
  const [backendError, setBackendError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);

  const titleId = `review-device-request-${action}-title`;
  const isApprove = action === "approve";

  async function confirm() {
    if (submittingRef.current) {
      return;
    }

    setBackendError(null);
    submittingRef.current = true;
    setSubmitting(true);

    try {
      const note = reviewNote.trim() || undefined;
      const api = getAuthService().getClient();

      if (isApprove) {
        await approveDeviceChangeRequest(api, request.id, note);
      } else {
        await rejectDeviceChangeRequest(api, request.id, note);
      }

      onResolved(action);
    } catch (error) {
      if (isStaleRequestError(error)) {
        onStale();
        return;
      }

      if (isNetworkError(error)) {
        setBackendError(t("admin.shell.apiUnavailable"));
      } else {
        setBackendError(t(resolveErrorMessageKey(error, "admin.deviceRequests.errorGeneric")));
      }
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <Modal titleId={titleId} onClose={onClose}>
      <div className="auth-form">
        <h2 id={titleId}>{t(isApprove ? "admin.deviceRequests.approveDialogTitle" : "admin.deviceRequests.rejectDialogTitle")}</h2>
        <p className="form-note">{t(isApprove ? "admin.deviceRequests.approveDialogCopy" : "admin.deviceRequests.rejectDialogCopy")}</p>

        <dl className="detail-grid">
          <div>
            <dt>{t("admin.deviceRequests.columnStudent")}</dt>
            <dd className="id-value">{request.studentUserId}</dd>
          </div>
          <div>
            <dt>{t("admin.deviceRequests.columnRequestedAt")}</dt>
            <dd>{formatDateTime(request.requestedAt)}</dd>
          </div>
        </dl>

        <div className="field">
          <label htmlFor="review-note">{t("admin.deviceRequests.reviewNoteLabel")}</label>
          <textarea
            id="review-note"
            rows={3}
            maxLength={1000}
            value={reviewNote}
            onChange={(event) => setReviewNote(event.target.value)}
            disabled={submitting}
          />
        </div>

        {backendError ? (
          <div className="form-error" role="alert">
            {backendError}
          </div>
        ) : null}

        <div className="modal-actions">
          <button className="secondary-button" type="button" onClick={onClose} disabled={submitting} autoFocus>
            {t("common.cancel")}
          </button>
          <button
            className={isApprove ? "primary-button" : "primary-button danger-button"}
            type="button"
            onClick={confirm}
            disabled={submitting}
          >
            {submitting
              ? t(isApprove ? "admin.deviceRequests.approving" : "admin.deviceRequests.rejecting")
              : t(isApprove ? "admin.deviceRequests.approveConfirm" : "admin.deviceRequests.rejectConfirm")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
