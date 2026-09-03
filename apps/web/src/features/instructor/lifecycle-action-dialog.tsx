"use client";

import type { ReactNode } from "react";
import { Modal } from "@/features/instructor/students/dialog";
import { useI18n } from "@/lib/i18n/i18n";
import type { TranslationKey } from "@/lib/i18n/translations";

export type LifecycleActionCopy = {
  title: TranslationKey;
  body: TranslationKey;
  confirm: TranslationKey;
  pending: TranslationKey;
};

/**
 * Shared confirmation shell for every Course/Section/Lesson/Quiz lifecycle
 * action (Make Live, Take Offline, Archive, Restore). Each feature keeps its
 * own thin wrapper (e.g. courses/lifecycle-confirm-dialog.tsx) that knows
 * which service call to make for its entity and how to map that entity's own
 * backend error codes to a message key - this shared component only owns the
 * Modal shell, copy slots, pending/error rendering, and the Cancel/Confirm
 * button pair, so that shape (previously copy-pasted once per entity) is
 * defined exactly once. See docs/DECISIONS.md DEC-0048 and its 2026-09-03
 * Take Offline/Restore addenda for why all four actions get identical
 * confirm-then-mutate treatment: each is an explicit, backend-enforced
 * lifecycle transition, not a silent client-side status flip.
 */
export function LifecycleActionDialog({
  titleId,
  entityTitle,
  copy,
  danger,
  backendError,
  submitting,
  onConfirm,
  onClose,
  children,
}: {
  titleId: string;
  entityTitle: string;
  copy: LifecycleActionCopy;
  /** Danger (red) confirm styling - Archive only. Restore/Take Offline/Publish are reversible, ordinary actions. */
  danger: boolean;
  backendError: string | null;
  submitting: boolean;
  onConfirm: () => void;
  onClose: () => void;
  /** Extra content between the body copy and any error, e.g. Course's readiness summary on Publish. */
  children?: ReactNode;
}) {
  const { t } = useI18n();

  return (
    <Modal titleId={titleId} onClose={onClose}>
      <div className="auth-form">
        <h2 id={titleId}>{t(copy.title)}</h2>
        <p className="form-note">
          {t(copy.body)} <strong>{entityTitle}</strong>
        </p>

        {children}

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
            className={danger ? "primary-button danger-button" : "primary-button"}
            type="button"
            onClick={onConfirm}
            disabled={submitting}
          >
            {submitting ? t(copy.pending) : t(copy.confirm)}
          </button>
        </div>
      </div>
    </Modal>
  );
}
