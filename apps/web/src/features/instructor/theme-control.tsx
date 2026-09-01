"use client";

import type { KeyboardEvent } from "react";
import { useI18n } from "@/lib/i18n/i18n";
import { useTheme, type ThemePreference } from "@/lib/theme/theme";

const OPTIONS: Array<{ value: ThemePreference; labelKey: "shell.themeLight" | "shell.themeDark" | "shell.themeSystem" }> = [
  { value: "light", labelKey: "shell.themeLight" },
  { value: "system", labelKey: "shell.themeSystem" },
  { value: "dark", labelKey: "shell.themeDark" },
];

/**
 * Restrained three-state Light/System/Dark switch. A radiogroup rather than
 * a dropdown/menu: it's one compact row with no popover to manage, stays
 * legible at every breakpoint including the mobile drawer, and needs no
 * icon library - each option is its own always-visible, always-labelled
 * button so there's nothing for a screen reader (or a glance) to miss.
 */
export function ThemeControl() {
  const { t, dir } = useI18n();
  const { theme, setTheme } = useTheme();
  const activeIndex = OPTIONS.findIndex((option) => option.value === theme);

  // Roving tabindex per the WAI-ARIA radiogroup pattern: only the selected
  // option is a tab stop, and the arrow keys move both focus and the
  // selection across it. Left/right are flipped in RTL so "next" always
  // moves in reading order.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const forward = dir === "rtl" ? "ArrowLeft" : "ArrowRight";
    const backward = dir === "rtl" ? "ArrowRight" : "ArrowLeft";
    let nextIndex: number | null = null;

    if (event.key === forward || event.key === "ArrowDown") {
      nextIndex = (activeIndex + 1 + OPTIONS.length) % OPTIONS.length;
    } else if (event.key === backward || event.key === "ArrowUp") {
      nextIndex = (activeIndex - 1 + OPTIONS.length) % OPTIONS.length;
    }

    if (nextIndex !== null) {
      event.preventDefault();
      setTheme(OPTIONS[nextIndex].value);
    }
  };

  return (
    <div className="theme-control" role="radiogroup" aria-label={t("shell.theme")} onKeyDown={onKeyDown}>
      {OPTIONS.map((option, index) => {
        const checked = theme === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={index === (activeIndex === -1 ? 0 : activeIndex) ? 0 : -1}
            className={checked ? "theme-control-option active" : "theme-control-option"}
            onClick={() => setTheme(option.value)}
          >
            <ThemeIcon value={option.value} />
            <span className="sr-only">{t(option.labelKey)}</span>
          </button>
        );
      })}
    </div>
  );
}

function ThemeIcon({ value }: { value: ThemePreference }) {
  if (value === "light") {
    return (
      <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
        <circle cx="10" cy="10" r="3.6" />
        <path d="M10 2.5v2M10 15.5v2M17.5 10h-2M4.5 10h-2M15.3 4.7l-1.4 1.4M6.1 13.9l-1.4 1.4M15.3 15.3l-1.4-1.4M6.1 6.1 4.7 4.7" />
      </svg>
    );
  }

  if (value === "dark") {
    return (
      <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M16.8 12.1A6.8 6.8 0 0 1 7.9 3.2a6.8 6.8 0 1 0 8.9 8.9Z" />
      </svg>
    );
  }

  return (
    <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2.6" y="4" width="14.8" height="9.6" rx="1.5" />
      <path d="M7.2 17h5.6M10 13.6V17" />
    </svg>
  );
}
