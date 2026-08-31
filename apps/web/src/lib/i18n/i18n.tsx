"use client";

import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import { locales, translations, type Locale, type TranslationKey } from "./translations";

const LANGUAGE_STORAGE_KEY = "edvora.web.locale";

// Applies the dir/lang attributes before the browser paints on the client, so a
// returning Arabic user does not see a brief LTR flash. Falls back to useEffect
// during SSR, where useLayoutEffect would otherwise warn and do nothing.
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

type I18nContextValue = {
  locale: Locale;
  dir: "ltr" | "rtl";
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() =>
    typeof window === "undefined" ? "en" : resolveStoredLocale(window.localStorage),
  );

  const setLocale = (nextLocale: Locale) => {
    setLocaleState(nextLocale);

    if (typeof window !== "undefined") {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, nextLocale);
    }
  };

  const value = useMemo<I18nContextValue>(() => {
    const dir = locales[locale].dir;
    return {
      locale,
      dir,
      setLocale,
      t: (key) => translations[locale][key],
    };
  }, [locale]);

  useIsomorphicLayoutEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = value.dir;
  }, [locale, value.dir]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const value = useContext(I18nContext);

  if (!value) {
    throw new Error("useI18n must be used inside I18nProvider.");
  }

  return value;
}

export function resolveStoredLocale(storage: Pick<Storage, "getItem">): Locale {
  const stored = storage.getItem(LANGUAGE_STORAGE_KEY);
  return stored === "ar" ? "ar" : "en";
}
