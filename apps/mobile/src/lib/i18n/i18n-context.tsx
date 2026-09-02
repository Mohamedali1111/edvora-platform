import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Localization from 'expo-localization';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { I18nManager } from 'react-native';
import { locales, translations, type Direction, type Locale, type TranslationKey } from './translations';

const LOCALE_STORAGE_KEY = 'edvora.mobile.locale';

type I18nContextValue = {
  locale: Locale;
  dir: Direction;
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey) => string;
  /**
   * True right after `setLocale` flips text direction (LTR<->RTL). `I18nManager.forceRTL`
   * only takes full effect for native layout (flex/text alignment resolved by the native
   * layout engine) after the app restarts, so the UI must show a "restart to apply" notice
   * rather than claim the flip is already complete.
   */
  restartRequiredForDirection: boolean;
};

const I18nContext = createContext<I18nContextValue | null>(null);

function isLocale(value: unknown): value is Locale {
  return value === 'en' || value === 'ar';
}

function detectDeviceLocale(): Locale {
  try {
    const preferred = Localization.getLocales?.()[0]?.languageCode;
    return preferred === 'ar' ? 'ar' : 'en';
  } catch {
    return 'en';
  }
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('en');
  const [hydrated, setHydrated] = useState(false);
  const [restartRequiredForDirection, setRestartRequiredForDirection] = useState(false);

  useEffect(() => {
    let cancelled = false;

    AsyncStorage.getItem(LOCALE_STORAGE_KEY)
      .then((stored) => {
        const resolved = isLocale(stored) ? stored : detectDeviceLocale();

        if (!cancelled) {
          setLocaleState(resolved);
          applyNativeDirection(resolved);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) {
          setHydrated(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const setLocale = (next: Locale) => {
    const directionChanged = locales[next].dir !== locales[locale].dir;
    setLocaleState(next);
    AsyncStorage.setItem(LOCALE_STORAGE_KEY, next).catch(() => undefined);

    if (directionChanged) {
      applyNativeDirection(next);
      setRestartRequiredForDirection(true);
    }
  };

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      dir: locales[locale].dir,
      setLocale,
      t: (key) => translations[locale][key],
      restartRequiredForDirection,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [locale, restartRequiredForDirection],
  );

  if (!hydrated) {
    return null;
  }

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const value = useContext(I18nContext);

  if (!value) {
    throw new Error('useI18n must be used inside I18nProvider.');
  }

  return value;
}

function applyNativeDirection(locale: Locale): void {
  const isRtl = locales[locale].dir === 'rtl';

  if (I18nManager.isRTL === isRtl) {
    return;
  }

  I18nManager.allowRTL(isRtl);
  I18nManager.forceRTL(isRtl);
}
