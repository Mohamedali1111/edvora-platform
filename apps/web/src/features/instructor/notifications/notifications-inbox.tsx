"use client";

import { useState } from "react";
import { canGoNext, canGoPrevious, nextOffset, previousOffset } from "@/features/instructor/students/pagination";
import { getAuthService } from "@/lib/api/session";
import type { NotificationCategory, NotificationSummary } from "@/lib/api/types";
import { useI18n } from "@/lib/i18n/i18n";
import type { TranslationKey } from "@/lib/i18n/translations";
import { isNetworkError, resolveErrorMessageKey } from "./error-mapping";
import { formatDateTime } from "./format";
import { markNotificationRead, NOTIFICATIONS_PAGE_SIZE, useNotificationsList } from "./notifications-service";

const CATEGORY_KEY: Record<NotificationCategory, TranslationKey> = {
  SYSTEM: "notifications.categorySystem",
  COURSE: "notifications.categoryCourse",
  SECURITY: "notifications.categorySecurity",
  ADMIN: "notifications.categoryAdmin",
};

/**
 * Instructor Notifications inbox - Slice H. Read-only content: `title`/
 * `body` are rendered as plain text (React's default text-node escaping,
 * never `dangerouslySetInnerHTML`), and the only mutation this page can
 * ever trigger is the frozen single-notification mark-read action. There is
 * no mark-all-read endpoint on the Instructor controller (only Student has
 * one) - see the Slice H report - so this page deliberately has no
 * "mark all read" control rather than faking one with N requests.
 */
export function NotificationsInbox() {
  const { t } = useI18n();
  const [offset, setOffset] = useState(0);
  const [markingIds, setMarkingIds] = useState<Set<string>>(new Set());
  const [rowErrors, setRowErrors] = useState<Record<string, unknown>>({});
  const { state, retry, applyUpdatedNotification } = useNotificationsInbox(offset);

  async function handleMarkRead(notification: NotificationSummary) {
    if (markingIds.has(notification.notificationId)) {
      return;
    }

    setMarkingIds((current) => new Set(current).add(notification.notificationId));
    setRowErrors((current) => {
      const next = { ...current };
      delete next[notification.notificationId];
      return next;
    });

    try {
      const updated = await markNotificationRead(getAuthService().getClient(), notification.notificationId);
      applyUpdatedNotification(updated);
    } catch (error) {
      setRowErrors((current) => ({ ...current, [notification.notificationId]: error }));
    } finally {
      setMarkingIds((current) => {
        const next = new Set(current);
        next.delete(notification.notificationId);
        return next;
      });
    }
  }

  return (
    <div className="notifications-page">
      <div className="page-header">
        <div>
          <h2>{t("nav.notifications")}</h2>
          <p className="page-subtitle">{t("notifications.subtitle")}</p>
        </div>
      </div>

      {state.status === "loading" ? (
        <p className="overview-loading" role="status">
          {t("overview.loading")}
        </p>
      ) : state.status === "error" ? (
        <div className="overview-error" role="alert">
          <p>{isNetworkError(state.error) ? t("shell.apiUnavailable") : t("notifications.errorLoad")}</p>
          <button className="secondary-button compact-action" type="button" onClick={retry}>
            {t("shell.retry")}
          </button>
        </div>
      ) : state.data.items.length === 0 ? (
        <div className="empty-state empty-state-compact">
          <span className="empty-state-icon" aria-hidden="true">
            <NotificationMiniIcon />
          </span>
          <p>{t("notifications.empty")}</p>
        </div>
      ) : (
        <>
          <ul className="notifications-list">
            {state.data.items.map((notification) => {
              const marking = markingIds.has(notification.notificationId);
              const rowError = rowErrors[notification.notificationId];

              return (
                <li key={notification.notificationId} className={notification.read ? "notification-row" : "notification-row notification-row-unread"}>
                  <div className="notification-row-header">
                    <span className={`status-badge status-badge-notification-${notification.category.toLowerCase()}`}>{t(CATEGORY_KEY[notification.category])}</span>
                    <span className={`status-badge ${notification.read ? "status-badge-read" : "status-badge-unread"}`}>
                      {notification.read ? t("notifications.readState") : t("notifications.unreadState")}
                    </span>
                  </div>

                  <p className="notification-title">{notification.title}</p>
                  <p className="notification-body">{notification.body}</p>

                  <div className="notification-row-footer">
                    <span className="notification-timestamp">
                      <span className="sr-only">{t("notifications.receivedAtLabel")}: </span>
                      <time dateTime={notification.createdAt}>{formatDateTime(notification.createdAt)}</time>
                    </span>

                    {!notification.read ? (
                      <button
                        className="ghost-button compact"
                        type="button"
                        onClick={() => handleMarkRead(notification)}
                        disabled={marking}
                        aria-label={t("notifications.markReadLabel").replace("{title}", notification.title)}
                      >
                        {marking ? t("notifications.markReadPending") : t("notifications.markReadAction")}
                      </button>
                    ) : null}
                  </div>

                  {rowError !== undefined ? (
                    <p className="field-error" role="alert">
                      {isNetworkError(rowError) ? t("shell.apiUnavailable") : t(resolveErrorMessageKey(rowError, "notifications.markReadErrorGeneric"))}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>

          <div className="pagination-controls" aria-label={t("pagination.pageLabel")}>
            <button className="secondary-button compact" type="button" onClick={() => setOffset((value) => previousOffset(value, NOTIFICATIONS_PAGE_SIZE))} disabled={!canGoPrevious(offset)}>
              {t("pagination.previous")}
            </button>
            <button className="secondary-button compact" type="button" onClick={() => setOffset((value) => nextOffset(value, NOTIFICATIONS_PAGE_SIZE))} disabled={!canGoNext(state.data.hasMore)}>
              {t("pagination.next")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function NotificationMiniIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 8.1a4 4 0 0 1 8 0c0 3.65 1.15 4.75 1.15 4.75H4.85S6 11.75 6 8.1Z" />
      <path d="M8.35 15.6a1.75 1.75 0 0 0 3.3 0" />
    </svg>
  );
}

/**
 * Wraps `useNotificationsList` with a setter that applies each backend-
 * returned `NotificationSummary` (from a successful mark-read call) onto
 * the currently-loaded page in place - never a locally-invented `read`/
 * `readAt` value, always the exact row the backend returned. Patches are
 * keyed by notification id (so marking several rows read on the same page
 * doesn't clobber each other - a single-slot override would lose the first
 * mark-read the moment a second one succeeded) and are reset whenever the
 * page changes, the same reset-during-render pattern every list hook in
 * this app uses for its own key (see `useNotificationsList` above).
 */
function useNotificationsInbox(offset: number) {
  const { state: listState, retry } = useNotificationsList(offset);
  const [patches, setPatches] = useState<Record<string, NotificationSummary>>({});
  const [trackedOffset, setTrackedOffset] = useState(offset);

  if (trackedOffset !== offset) {
    setTrackedOffset(offset);
    setPatches({});
  }

  const state =
    listState.status === "ready"
      ? {
          status: "ready" as const,
          data: {
            ...listState.data,
            items: listState.data.items.map((item) => patches[item.notificationId] ?? item),
          },
        }
      : listState;

  return {
    state,
    retry: () => {
      setPatches({});
      retry();
    },
    applyUpdatedNotification: (notification: NotificationSummary) => setPatches((current) => ({ ...current, [notification.notificationId]: notification })),
  };
}
