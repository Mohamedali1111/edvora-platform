"use client";

import { useState } from "react";
import { getAuthService } from "@/lib/api/session";
import { useI18n } from "@/lib/i18n/i18n";
import type { TranslationKey } from "@/lib/i18n/translations";
import type { CourseSectionSummary, ReadinessIssue, SectionStatus } from "@/lib/api/types";
import { NavIcon } from "@/features/instructor/nav-icons";
import { ActionMenu, type ActionMenuItem } from "@/features/instructor/action-menu";
import { reorderSections, type SectionsWithLessonsLoadState } from "./sections-service";
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
 * The Chapter builder (product-facing "Chapter" - the backend model and
 * every service/type/route underneath this stays "Section", matching the
 * approved "vocabulary in UI only" instruction). A Chapter's editability/
 * lifecycle actions depend only on its own status, never the parent
 * Course's - confirmed against the backend (no Course-status check exists
 * in any CourseSectionService method) and documented as deliberate
 * ("archiving does not cascade... preserving descendant authoring state").
 *
 * Data (`state`) is owned by the Course Builder page (course-detail.tsx via
 * `useSectionsWithLessons`), not fetched here - the same load also drives
 * the header's Chapter count and the per-Lesson readiness join, so one
 * fetch serves all three rather than three separate ones.
 *
 * Row shape (Instructor Web Management Action System): the row itself is
 * the primary "reveal this Chapter's Lessons" control (a real button, not a
 * click-only div), and every contextual action (Edit, Move up/down,
 * Publish, Hide from students, Archive, Restore) lives in one overflow
 * menu instead of a row of equally-weighted buttons. Only one Chapter is
 * expanded at a time (an accordion) - this is the same interaction model
 * at every viewport width, phone included, rather than a separate
 * mobile-only drilldown route: with everything already inline and only one
 * Chapter's Lessons visible at once, it already reads as a focused
 * "Chapter management view" without needing parallel routing.
 */
export function SectionsPanel({
  tenantId,
  courseId,
  state,
  onRetry,
  onContentChanged,
  readinessBlockersByLessonId,
}: {
  tenantId: string;
  courseId: string;
  state: SectionsWithLessonsLoadState;
  onRetry: () => void;
  /**
   * Called after a Chapter/Lesson create or lifecycle (publish/take
   * offline/archive/restore) change - see course-detail.tsx's
   * `bumpContentVersion`, which this ultimately drives the Readiness Strip
   * with. Reorder and plain metadata edits are deliberately not reported:
   * neither changes anything readiness derives from (status or content
   * readiness), so reporting them would only trigger a wasted refetch.
   */
  onContentChanged: () => void;
  /** Server readiness blockers grouped by Lesson id - `undefined` while readiness itself hasn't loaded yet, in which case Lesson rows simply show no content-status badge (see readiness-copy.ts's `lessonContentReadiness`). */
  readinessBlockersByLessonId: ReadonlyMap<string, ReadinessIssue[]> | undefined;
}) {
  const { t } = useI18n();
  const [createOpen, setCreateOpen] = useState(false);
  const [editingSection, setEditingSection] = useState<CourseSectionSummary | null>(null);
  const [lifecycleTarget, setLifecycleTarget] = useState<LifecycleTarget | null>(null);
  const [reordering, setReordering] = useState(false);
  const [reorderError, setReorderError] = useState<string | null>(null);
  const [expandedSectionId, setExpandedSectionId] = useState<string | null>(null);

  const sections = state.status === "ready" ? state.data : [];

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
      onRetry();
    } catch (error) {
      if (isNetworkError(error)) {
        setReorderError(t("shell.apiUnavailable"));
      } else {
        setReorderError(t(resolveErrorMessageKey(error, "sections.reorderErrorGeneric")));
      }
      // Any reorder failure (position race, a chapter archived/created concurrently) means this
      // page's snapshot may be stale - refetch so the next move is computed from real order.
      onRetry();
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
          <button className="secondary-button compact-action" type="button" onClick={onRetry}>
            {t("shell.retry")}
          </button>
        </div>
      ) : sections.length === 0 ? (
        <div className="empty-state">
          <span className="empty-state-icon" aria-hidden="true">
            <NavIcon section="courses" />
          </span>
          <p>{t("sections.empty")}</p>
        </div>
      ) : (
        <ol className="section-list">
          {sections.map((section) => {
            const order = reorderableSectionIds(sections);
            const isExpanded = expandedSectionId === section.sectionId;
            const lessonsRegionId = `section-lessons-${section.sectionId}`;
            const activeLessonCount = section.lessons.filter((lesson) => lesson.status !== "ARCHIVED").length;

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
                      <span className="table-secondary-text">
                        {section.description ? `${section.description} · ` : ""}
                        {t("sections.lessonCount").replace("{count}", String(activeLessonCount))}
                      </span>
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
                      lessons={section.lessons}
                      readinessBlockersByLessonId={readinessBlockersByLessonId}
                      onRefresh={onRetry}
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
          onCreated={(created) => {
            setCreateOpen(false);
            onRetry();
            onContentChanged();
            // Jump straight into the new Chapter - the obvious next step is
            // Add lesson, so land the instructor exactly where they'd go
            // next instead of leaving them to find and reopen a collapsed
            // row they just created.
            setExpandedSectionId(created.sectionId);
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
            onRetry();
          }}
          onConflict={onRetry}
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
            onRetry();
            onContentChanged();
          }}
          onConflict={onRetry}
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
