"use client";

import type { ReactNode } from "react";
import { canGoNext, canGoPrevious, nextOffset, previousOffset } from "@/features/instructor/students/pagination";
import { useI18n } from "@/lib/i18n/i18n";
import type { TranslationKey } from "@/lib/i18n/translations";
import { isNetworkError } from "./error-mapping";
import type { EntityPickerLoadState } from "./progress-service";

/**
 * Shared bounded, page-at-a-time single-select list - the Progress tab's
 * Course picker, the Quiz Results tab's Quiz picker, and its optional
 * Student filter picker are all one of these with different data/copy.
 * Reuses the same `.course-selector-list`/`.course-selector-option`/
 * `.pagination-controls` chrome the Enrollment "select a course" dialog and
 * the Lesson content picker already established (see dialogs.css) - never
 * fetches or renders more than one page, and never implies the first page
 * is the complete set.
 */
export function EntityPicker<T>({
  labelId,
  state,
  retry,
  offset,
  onOffsetChange,
  pageSize,
  getId,
  renderOption,
  selectedId,
  onSelect,
  loadingErrorFallback,
  emptyLabel,
}: {
  labelId: string;
  state: EntityPickerLoadState<T>;
  retry: () => void;
  offset: number;
  onOffsetChange: (offset: number) => void;
  pageSize: number;
  getId: (item: T) => string;
  renderOption: (item: T) => ReactNode;
  selectedId: string | null;
  onSelect: (item: T) => void;
  loadingErrorFallback: TranslationKey;
  emptyLabel: TranslationKey;
}) {
  const { t } = useI18n();

  if (state.status === "loading") {
    return (
      <p className="overview-loading" role="status">
        {t("overview.loading")}
      </p>
    );
  }

  if (state.status === "error") {
    return (
      <div className="overview-unavailable">
        {isNetworkError(state.error) ? t("shell.apiUnavailable") : t(loadingErrorFallback)}{" "}
        <button className="ghost-button compact" type="button" onClick={retry}>
          {t("shell.retry")}
        </button>
      </div>
    );
  }

  const pageItems = state.data.items;

  if (pageItems.length === 0 && offset === 0) {
    return <p className="overview-empty">{t(emptyLabel)}</p>;
  }

  return (
    <>
      <ul className="course-selector-list" role="radiogroup" aria-labelledby={labelId}>
        {pageItems.map((item) => {
          const id = getId(item);
          return (
            <li key={id}>
              <label className="course-selector-option">
                <input type="radio" name={labelId} value={id} checked={selectedId === id} onChange={() => onSelect(item)} />
                {renderOption(item)}
              </label>
            </li>
          );
        })}
      </ul>
      <div className="pagination-controls" aria-label={t("pagination.pageLabel")}>
        <button className="secondary-button compact" type="button" onClick={() => onOffsetChange(previousOffset(offset, pageSize))} disabled={!canGoPrevious(offset)}>
          {t("pagination.previous")}
        </button>
        <button
          className="secondary-button compact"
          type="button"
          onClick={() => onOffsetChange(nextOffset(offset, pageSize))}
          disabled={!canGoNext(state.data.hasMore)}
        >
          {t("pagination.next")}
        </button>
      </div>
    </>
  );
}
