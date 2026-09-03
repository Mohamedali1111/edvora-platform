"use client";

import { useState } from "react";
import { getAuthService } from "@/lib/api/session";
import { useI18n } from "@/lib/i18n/i18n";
import type { TranslationKey } from "@/lib/i18n/translations";
import type { CourseSectionSummary, SectionStatus } from "@/lib/api/types";
import { NavIcon } from "@/features/instructor/nav-icons";
import { ActionMenu, type ActionMenuItem } from "@/features/instructor/action-menu";
import { reorderSections, useSectionsList } from "./sections-service";
import {
  canArchiveSection,
  canEditSectionMetadata,
  canPublishSection,
  canReorderSection,
  canRestoreSection,
  canTakeSectionOffline,
} from "./lifecycle";
import { moveEarlier, moveLater, reorderableSectionIds } from "./ordering";
import { isNetworkError, resolveErrorMessageKey } from "./error-mapping";
import { CreateSectionDialog } from "./create-section-dialog";
import { EditSectionDialog } from "./edit-section-dialog";
import { SectionLifecycleConfirmDialog, type SectionLifecycleAction } from "./section-lifecycle-confirm-dialog";
import { LessonsPanel } from "./lessons/lessons-panel";

const SECTION_STATUS_KEY: Record<SectionStatus, TranslationKey> = {
  DRAFT: "sections.statusDraft",
  PUBLISHED: "sections.statusPublished",
  ARCHIVED: "sections.statusArchived",
};

type LifecycleTarget = { action: SectionLifecycleAction; section: CourseSectionSummary };

/**
 * A Section's editability/lifecycle actions depend only on its own status,
 * never the parent Course's - confirmed against the frozen backend (no
 * Course-status check exists in any CourseSectionService method) and
 * documented as deliberate ("archiving does not cascade... preserving
 * descendant authoring state"). This panel is therefore self-contained and
 * doesn't need the Course's own status at all.
 *
 * Row shape (Instructor Web Management Action System): the row itself is the
 * primary "reveal this section's lessons" control (a real button, not a
 * click-only div - `aria-expanded`/`aria-controls` keep it keyboard- and
 * screen-reader-operable exactly like the dedicated Show/Hide Lessons button
 * it replaces), and every contextual action (Edit, Move up/down, Publish,
 * Take Offline, Archive, Restore) lives in one overflow menu instead of a
 * row of equally-weighted buttons.
 */
export function SectionsPanel({
  tenantId,
  courseId,
  onContentChanged,
}: {
  tenantId: string;
  courseId: string;
  /**
   * Called after a Section create or lifecycle (publish/take offline/
   * archive/restore) change, and forwarded down to `LessonsPanel` for the
   * equivalent Lesson mutations - see `course-detail.tsx`'s
   * `bumpContentVersion`, which this ultimately drives the Course Readiness
   * panel with. Reorder and plain metadata edits are deliberately not
   * reported: neither changes anything `readiness.ts` derives from (status
   * or content readiness), so reporting them would only trigger wasted
   * refetches.
   */
  onContentChanged: () => void;
}) {
  const { t } = useI18n();
  const { state, retry } = useSectionsList(tenantId, courseId);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingSection, setEditingSection] = useState<CourseSectionSummary | null>(null);
  const [lifecycleTarget, setLifecycleTarget] = useState<LifecycleTarget | null>(null);
  const [reordering, setReordering] = useState(false);
  const [reorderError, setReorderError] = useState<string | null>(null);
  const [expandedSectionId, setExpandedSectionId] = useState<string | null>(null);

  async function handleMove(section: CourseSectionSummary, direction: "earlier" | "later") {
    if (reordering || state.status !== "ready") {
      return;
    }

    const order = reorderableSectionIds(state.data);
    const next = direction === "earlier" ? moveEarlier(order, section.sectionId) : moveLater(order, section.sectionId);

    if (!next) {
      return;
    }

    setReordering(true);
    setReorderError(null);

    try {
      await reorderSections(getAuthService().getClient(), tenantId, courseId, next);
      retry();
    } catch (error) {
      if (isNetworkError(error)) {
        setReorderError(t("shell.apiUnavailable"));
      } else {
        setReorderError(t(resolveErrorMessageKey(error, "sections.reorderErrorGeneric")));
      }
      // Any reorder failure (position race, a section archived/created concurrently) means this
      // page's snapshot may be stale - refetch so the next move is computed from real order.
      retry();
    } finally {
      setReordering(false);
    }
  }

  function sectionActions(section: CourseSectionSummary, order: string[]): ActionMenuItem[] {
    const items: ActionMenuItem[] = [];

    if (canEditSectionMetadata(section.status)) {
      items.push({ key: "edit", label: t("sections.editAction"), onSelect: () => setEditingSection(section) });
    }

    if (canReorderSection(section.status)) {
      const canMoveEarlier = moveEarlier(order, section.sectionId) !== null;
      const canMoveLater = moveLater(order, section.sectionId) !== null;

      items.push({
        key: "move-earlier",
        label: t("sections.moveEarlierAction"),
        disabled: !canMoveEarlier,
        disabledReason: canMoveEarlier ? undefined : t("common.alreadyFirst"),
        onSelect: () => void handleMove(section, "earlier"),
      });
      items.push({
        key: "move-later",
        label: t("sections.moveLaterAction"),
        disabled: !canMoveLater,
        disabledReason: canMoveLater ? undefined : t("common.alreadyLast"),
        onSelect: () => void handleMove(section, "later"),
      });
    }

    if (canPublishSection(section.status)) {
      items.push({ key: "publish", label: t("courses.publishAction"), onSelect: () => setLifecycleTarget({ action: "publish", section }) });
    }

    if (canTakeSectionOffline(section.status)) {
      items.push({
        key: "takeOffline",
        label: t("courses.takeOfflineAction"),
        onSelect: () => setLifecycleTarget({ action: "takeOffline", section }),
      });
    }

    if (canArchiveSection(section.status)) {
      items.push({
        key: "archive",
        label: t("courses.archiveAction"),
        danger: true,
        onSelect: () => setLifecycleTarget({ action: "archive", section }),
      });
    }

    if (canRestoreSection(section.status)) {
      items.push({ key: "restore", label: t("courses.restoreAction"), onSelect: () => setLifecycleTarget({ action: "restore", section }) });
    }

    return items;
  }

  return (
    <div className="section-panel">
      <div className="modal-actions">
        <button className="primary-button compact-action" type="button" onClick={() => setCreateOpen(true)}>
          {t("sections.createAction")}
        </button>
      </div>

      {reordering ? (
        <p className="overview-loading" role="status">
          {t("sections.reordering")}
        </p>
      ) : null}
      {reorderError ? (
        <div className="form-error" role="alert">
          {reorderError}
        </div>
      ) : null}

      {state.status === "loading" ? (
        <p className="overview-loading" role="status">
          {t("overview.loading")}
        </p>
      ) : state.status === "error" ? (
        <div className="overview-error" role="alert">
          <p>{isNetworkError(state.error) ? t("shell.apiUnavailable") : t(resolveErrorMessageKey(state.error, "sections.errorLoad"))}</p>
          <button className="secondary-button compact-action" type="button" onClick={retry}>
            {t("shell.retry")}
          </button>
        </div>
      ) : state.data.length === 0 ? (
        <div className="empty-state">
          <span className="empty-state-icon" aria-hidden="true">
            <NavIcon section="courses" />
          </span>
          <p>{t("sections.empty")}</p>
        </div>
      ) : (
        <ol className="section-list">
          {state.data.map((section) => {
            const order = reorderableSectionIds(state.data);
            const isExpanded = expandedSectionId === section.sectionId;
            const lessonsRegionId = `section-lessons-${section.sectionId}`;

            return (
              <li className="section-row-group" key={section.sectionId}>
                <div className="section-row">
                  <button
                    type="button"
                    className="section-row-primary"
                    aria-expanded={isExpanded}
                    aria-controls={lessonsRegionId}
                    onClick={() => setExpandedSectionId(isExpanded ? null : section.sectionId)}
                  >
                    <span className="section-row-main">
                      <strong>{section.title}</strong>
                      {section.description ? <span className="table-secondary-text">{section.description}</span> : null}
                    </span>
                    <ChevronIcon expanded={isExpanded} />
                    <span className="sr-only">
                      {t(isExpanded ? "sections.collapseRowLabel" : "sections.expandRowLabel").replace("{section}", section.title)}
                    </span>
                  </button>

                  <span className={`status-badge status-badge-${section.status.toLowerCase()}`}>
                    {t(SECTION_STATUS_KEY[section.status])}
                  </span>

                  <ActionMenu label={t("common.moreActionsFor").replace("{item}", section.title)} items={sectionActions(section, order)} />
                </div>

                {isExpanded ? (
                  <div className="section-lessons-area" id={lessonsRegionId}>
                    <LessonsPanel
                      tenantId={tenantId}
                      courseId={courseId}
                      sectionId={section.sectionId}
                      onContentChanged={onContentChanged}
                    />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}

      {createOpen ? (
        <CreateSectionDialog
          tenantId={tenantId}
          courseId={courseId}
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            setCreateOpen(false);
            retry();
            onContentChanged();
          }}
        />
      ) : null}

      {editingSection ? (
        <EditSectionDialog
          tenantId={tenantId}
          courseId={courseId}
          section={editingSection}
          onClose={() => setEditingSection(null)}
          onSaved={() => {
            setEditingSection(null);
            retry();
          }}
          onConflict={retry}
        />
      ) : null}

      {lifecycleTarget ? (
        <SectionLifecycleConfirmDialog
          action={lifecycleTarget.action}
          tenantId={tenantId}
          courseId={courseId}
          section={lifecycleTarget.section}
          onClose={() => setLifecycleTarget(null)}
          onDone={() => {
            setLifecycleTarget(null);
            retry();
            onContentChanged();
          }}
          onConflict={retry}
        />
      ) : null}
    </div>
  );
}

/** Expand/collapse chevron - rotates between collapsed (pointing down) and expanded (pointing up), a vertical distinction that reads the same in LTR and RTL, so unlike the shell's back-link arrow it never needs an `:dir(rtl)` mirror. */
function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="section-row-chevron"
      style={{ transform: expanded ? "rotate(180deg)" : "none" }}
    >
      <path d="M5 7.5 10 13l5-5.5" />
    </svg>
  );
}
