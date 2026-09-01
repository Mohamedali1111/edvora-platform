"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n/i18n";
import type { DeviceChangeRequestSummary } from "@/lib/api/types";
import { AdminNavIcon } from "../nav-icons";
import { formatDateTime } from "../format";
import { isNetworkError } from "../error-mapping";
import { canGoNext, canGoPrevious, nextOffset, previousOffset } from "../pagination";
import { DEVICE_REQUESTS_PAGE_SIZE, useDeviceChangeRequests } from "./device-requests-service";
import { ReviewDeviceRequestDialog, type ReviewAction } from "./review-device-request-dialog";

type ReviewIntent = { action: ReviewAction; request: DeviceChangeRequestSummary };

/**
 * The primary feature for this milestone: list pending student
 * device-change requests and let a Platform Admin approve or reject each
 * one. Every field rendered here is exactly what
 * `GET /admin/device-change-requests` returns - there is no student
 * email/displayName and no model/platform for the *current* device on this
 * frozen response (only the requested device carries that detail), so
 * those two cells intentionally show only the raw backend ID rather than a
 * fabricated name.
 */
export function DeviceRequestsList() {
  const { t } = useI18n();
  const [offset, setOffset] = useState(0);
  const [intent, setIntent] = useState<ReviewIntent | null>(null);
  const [resultMessage, setResultMessage] = useState<string | null>(null);
  const { state, retry } = useDeviceChangeRequests(offset);

  function handleResolved(action: ReviewAction) {
    setIntent(null);
    setResultMessage(t(action === "approve" ? "admin.deviceRequests.approveSuccess" : "admin.deviceRequests.rejectSuccess"));
    retry();
  }

  function handleStale() {
    setIntent(null);
    setResultMessage(t("admin.deviceRequests.errorAlreadyResolved"));
    retry();
  }

  return (
    <div className="admin-page">
      <div className="page-header">
        <div>
          <h2>{t("admin.nav.deviceRequests")}</h2>
          <p className="page-subtitle">{t("admin.deviceRequests.subtitle")}</p>
        </div>
      </div>

      {resultMessage ? (
        <div className="form-success" role="status">
          {resultMessage}
        </div>
      ) : null}

      {state.status === "loading" ? (
        <p className="admin-overview-loading" role="status">
          {t("admin.deviceRequests.loading")}
        </p>
      ) : state.status === "error" ? (
        <div className="admin-overview-error" role="alert">
          <p>{isNetworkError(state.error) ? t("admin.shell.apiUnavailable") : t("admin.deviceRequests.errorLoad")}</p>
          <button className="secondary-button compact-action" type="button" onClick={retry}>
            {t("admin.shell.retry")}
          </button>
        </div>
      ) : state.data.items.length === 0 ? (
        <div className="admin-empty-state">
          <span className="admin-empty-state-icon" aria-hidden="true">
            <AdminNavIcon section="deviceRequests" />
          </span>
          <p>{t("admin.deviceRequests.empty")}</p>
        </div>
      ) : (
        <>
          <div className="table-scroll">
            <table className="data-table device-requests-table">
              <caption className="sr-only">{t("admin.nav.deviceRequests")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("admin.deviceRequests.columnStudent")}</th>
                  <th scope="col" className="table-col-secondary">
                    {t("admin.deviceRequests.columnCurrentDevice")}
                  </th>
                  <th scope="col">{t("admin.deviceRequests.columnRequestedDevice")}</th>
                  <th scope="col" className="table-col-secondary">
                    {t("admin.deviceRequests.columnRequestedAt")}
                  </th>
                  <th scope="col">
                    <span className="sr-only">{t("admin.deviceRequests.columnActions")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {state.data.items.map((request) => (
                  <tr key={request.id}>
                    <td data-label={t("admin.deviceRequests.columnStudent")}>
                      <span className="id-value">{request.studentUserId}</span>
                    </td>
                    <td className="table-col-secondary" data-label={t("admin.deviceRequests.columnCurrentDevice")}>
                      {request.currentDeviceId ? <span className="id-value">{request.currentDeviceId}</span> : "—"}
                    </td>
                    <td data-label={t("admin.deviceRequests.columnRequestedDevice")}>
                      <RequestedDeviceCell request={request} />
                    </td>
                    <td className="table-col-secondary" data-label={t("admin.deviceRequests.columnRequestedAt")}>
                      {formatDateTime(request.requestedAt)}
                    </td>
                    <td data-label={t("admin.deviceRequests.columnActions")}>
                      <div className="device-request-actions">
                        <button
                          className="secondary-button compact"
                          type="button"
                          onClick={() => setIntent({ action: "reject", request })}
                        >
                          {t("admin.deviceRequests.rejectAction")}
                        </button>
                        <button
                          className="primary-button compact"
                          type="button"
                          onClick={() => setIntent({ action: "approve", request })}
                        >
                          {t("admin.deviceRequests.approveAction")}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="pagination-controls" aria-label={t("pagination.pageLabel")}>
            <button
              className="secondary-button compact"
              type="button"
              onClick={() => setOffset((value) => previousOffset(value, DEVICE_REQUESTS_PAGE_SIZE))}
              disabled={!canGoPrevious(offset)}
            >
              {t("pagination.previous")}
            </button>
            <button
              className="secondary-button compact"
              type="button"
              onClick={() => setOffset((value) => nextOffset(value, DEVICE_REQUESTS_PAGE_SIZE))}
              disabled={!canGoNext(state.data.hasMore)}
            >
              {t("pagination.next")}
            </button>
          </div>
        </>
      )}

      {intent ? (
        <ReviewDeviceRequestDialog
          action={intent.action}
          request={intent.request}
          onClose={() => setIntent(null)}
          onResolved={handleResolved}
          onStale={handleStale}
        />
      ) : null}
    </div>
  );
}

function RequestedDeviceCell({ request }: { request: DeviceChangeRequestSummary }) {
  const { t } = useI18n();
  const parts = [request.requestedPlatform, request.requestedDeviceModel, request.requestedOsVersion].filter(
    (value): value is string => !!value,
  );

  return (
    <div>
      <strong>{parts.length > 0 ? parts.join(" · ") : "—"}</strong>
      {request.requestedAppVersion ? (
        <span className="table-secondary-text">
          {t("admin.deviceRequests.appVersionLabel")} {request.requestedAppVersion}
        </span>
      ) : null}
    </div>
  );
}
