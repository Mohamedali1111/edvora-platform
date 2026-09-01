"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useI18n } from "@/lib/i18n/i18n";

const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), textarea, input:not([disabled]), select, [tabindex]:not([tabindex="-1"])';

/**
 * Small accessible modal shell for the admin feature area - initial focus,
 * Escape to close, a real Tab focus trap, and returning focus to whatever
 * triggered the dialog. Mirrors features/instructor/students/dialog.tsx's
 * plain-DOM approach (not a new UI framework) as its own self-contained
 * copy, per the "don't mix admin into instructor feature modules" rule.
 */
export function Modal({ titleId, onClose, children }: { titleId: string; onClose: () => void; children: ReactNode }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const { t } = useI18n();

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;

    if (!panelRef.current?.contains(document.activeElement)) {
      panelRef.current?.focus();
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const focusable = panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);

      if (!focusable || focusable.length === 0) {
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus();
    };
  }, [onClose]);

  return (
    <div className="modal-layer">
      <button className="modal-scrim" type="button" aria-label={t("common.close")} onClick={onClose} />
      <div className="modal-panel" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={panelRef} tabIndex={-1}>
        {children}
      </div>
    </div>
  );
}
