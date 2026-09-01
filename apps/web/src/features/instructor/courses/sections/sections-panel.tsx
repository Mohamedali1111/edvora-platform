"use client";

import { useState } from "react";
import { getAuthService } from "@/lib/api/session";
import { useI18n } from "@/lib/i18n/i18n";
import type { TranslationKey } from "@/lib/i18n/translations";
import type { CourseSectionSummary, SectionStatus } from "@/lib/api/types";
import { NavIcon } from "@/features/instructor/nav-icons";
import { MoveEarlierIcon, MoveLaterIcon } from "@/features/instructor/courses/ordering-icons";
import { reorderSections, useSectionsList } from "./sections-service";
import { canArchiveSection, canEditSectionMetadata, canPublishSection, canReorderSection } from "./lifecycle";
import { moveEarlier, moveLater, reorderableSectionIds } from "./ordering";
import { isNetworkError, resolveErrorMessageKey } from "./error-mapping";
import { CreateSectionDialog } from "./create-section-dialog";
import { EditSectionDialog } from "./edit-section-dialog";
import { SectionLifecycleConfirmDialog } from "./section-lifecycle-confirm-dialog";
import { LessonsPanel } from "./lessons/lessons-panel";

const SECTION_STATUS_KEY: Record<SectionStatus, TranslationKey> = {
  DRAFT: "sections.statusDraft",
  PUBLISHED: "sections.statusPublished",
  ARCHIVED: "sections.statusArchived",
};

type LifecycleTarget = { action: "publish" | "archive"; section: CourseSectionSummary };

/**
 * A Section's editability/lifecycle actions depend only on its own status,
 * never the parent Course's - confirmed against the frozen backend (no
 * Course-status check exists in any CourseSectionService method) and
 * documented as deliberate ("archiving does not cascade... preserving
 * descendant authoring state"). This panel is therefore self-contained and
 * doesn't need the Course's own status at all.
 */
export function SectionsPanel({ tenantId, courseId }: { tenantId: string; courseId: string }) {
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
            const canMoveEarlier = canReorderSection(section.status) && moveEarlier(order, section.sectionId) !== null;
            const canMoveLater = canReorderSection(section.status) && moveLater(order, section.sectionId) !== null;

            const isExpanded = expandedSectionId === section.sectionId;

            return (
              <li className="section-row-group" key={section.sectionId}>
                <div className="section-row">
                  <div className="section-row-main">
                    <strong>{section.title}</strong>
                    {section.description ? <span className="table-secondary-text">{section.description}</span> : null}
                  </div>

                  <span className={`status-badge status-badge-${section.status.toLowerCase()}`}>
                    {t(SECTION_STATUS_KEY[section.status])}
                  </span>

                  <div className="section-row-actions">
                    {canReorderSection(section.status) ? (
                      <>
                        <button
                          className="ghost-button compact icon-text-button"
                          type="button"
                          onClick={() => handleMove(section, "earlier")}
                          disabled={reordering || !canMoveEarlier}
                          aria-label={`${t("sections.moveEarlierAction")}: ${section.title}`}
                        >
                          <MoveEarlierIcon />
                          {t("sections.moveEarlierAction")}
                        </button>
                        <button
                          className="ghost-button compact icon-text-button"
                          type="button"
                          onClick={() => handleMove(section, "later")}
                          disabled={reordering || !canMoveLater}
                          aria-label={`${t("sections.moveLaterAction")}: ${section.title}`}
                        >
                          <MoveLaterIcon />
                          {t("sections.moveLaterAction")}
                        </button>
                      </>
                    ) : null}

                    {canEditSectionMetadata(section.status) ? (
                      <button className="ghost-button compact" type="button" onClick={() => setEditingSection(section)}>
                        {t("sections.editAction")}
                      </button>
                    ) : null}

                    {canPublishSection(section.status) ? (
                      <button
                        className="secondary-button compact"
                        type="button"
                        onClick={() => setLifecycleTarget({ action: "publish", section })}
                      >
                        {t("courses.publishAction")}
                      </button>
                    ) : null}

                    {canArchiveSection(section.status) ? (
                      <button
                        className="secondary-button compact"
                        type="button"
                        onClick={() => setLifecycleTarget({ action: "archive", section })}
                      >
                        {t("courses.archiveAction")}
                      </button>
                    ) : null}

                    <button
                      className="ghost-button compact"
                      type="button"
                      onClick={() => setExpandedSectionId(isExpanded ? null : section.sectionId)}
                      aria-expanded={isExpanded}
                    >
                      {isExpanded ? t("sections.hideLessonsAction") : t("sections.showLessonsAction")}
                    </button>
                  </div>
                </div>

                {isExpanded ? (
                  <div className="section-lessons-area">
                    <LessonsPanel tenantId={tenantId} courseId={courseId} sectionId={section.sectionId} />
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
          }}
          onConflict={retry}
        />
      ) : null}
    </div>
  );
}
