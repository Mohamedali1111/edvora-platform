"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useI18n } from "@/lib/i18n/i18n";

const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), textarea, input:not([disabled]), select, [tabindex]:not([tabindex="-1"])';

/**
 * Small accessible modal shell shared by every Slice C dialog (add student,
 * create enrollment, revoke confirmation) so keyboard behavior - initial
 * focus, Escape to close, a real Tab focus trap, and returning focus to
 * whatever triggered the dialog - is implemented once rather than three
 * times. Not a new UI framework: plain DOM APIs, matching the codebase's
 * existing conventions (see the mobile drawer in shell.tsx for the same
 * scrim-button pattern).
 */
export function Modal({
  titleId,
  onClose,
  children,
  size = "default",
}: {
  titleId: string;
  onClose: () => void;
  children: ReactNode;
  /** "wide" is for content that genuinely needs more room at desktop widths (e.g. the First-Publish Review's grouped Chapter/Lesson list) - every existing caller is unaffected by omitting it. */
  size?: "default" | "wide";
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const { t } = useI18n();

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;

    // Respect an element inside the panel that already claimed focus via
    // autoFocus (e.g. the revoke dialog's Cancel button); only default to
    // the panel itself otherwise.
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
      <div
        className={size === "wide" ? "modal-panel modal-panel-wide" : "modal-panel"}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={panelRef}
        tabIndex={-1}
      >
        {children}
      </div>
    </div>
  );
}
