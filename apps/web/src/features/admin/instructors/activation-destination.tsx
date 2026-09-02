"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n/i18n";

/** The one public route that consumes an Instructor activation code. Never carries the raw token itself - see docs on ActivateForm. */
export const INSTRUCTOR_ACTIVATION_PATH = "/auth/activate";

/**
 * Part C repair: the one-time activation handoff (both a brand-new instructor's and a reissued
 * one's) previously showed only the raw code, with no indication of where the instructor must
 * take it. Shown as its own block, deliberately separate from the token box above it - the code
 * and its destination are two different pieces of information an operator relays, and neither
 * ever appears inside the other (no token in a query string, no destination baked into the
 * code). Resolves the absolute URL from `window.location.origin` at render time rather than a
 * hardcoded environment value, so it always matches whatever origin the admin is actually using
 * (staging, production, or a future custom domain) without needing its own configuration.
 */
export function ActivationDestination() {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  const destination = typeof window === "undefined" ? INSTRUCTOR_ACTIVATION_PATH : `${window.location.origin}${INSTRUCTOR_ACTIVATION_PATH}`;

  async function copyDestination() {
    try {
      await navigator.clipboard.writeText(destination);
      setCopied(true);
    } catch {
      // Clipboard access can be unavailable/denied; the link stays visible and selectable regardless.
    }
  }

  return (
    <div className="admin-activation-destination">
      <span className="admin-activation-destination-label">{t("admin.instructors.activationDestinationLabel")}</span>
      <code className="admin-activation-destination-value">{destination}</code>
      <button className="ghost-button compact" type="button" onClick={copyDestination}>
        {copied ? t("admin.instructors.activationDestinationCopiedConfirmation") : t("admin.instructors.activationDestinationCopyAction")}
      </button>
    </div>
  );
}
