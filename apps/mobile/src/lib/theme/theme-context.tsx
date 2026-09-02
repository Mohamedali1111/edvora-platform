import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import { tokensFor, type ResolvedTheme, type ThemeTokens } from './tokens';

const THEME_STORAGE_KEY = 'edvora.mobile.theme';

export type ThemePreference = 'light' | 'dark' | 'system';

type ThemeContextValue = {
  preference: ThemePreference;
  resolvedTheme: ResolvedTheme;
  tokens: ThemeTokens;
  setPreference: (preference: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>('system');
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;

    AsyncStorage.getItem(THEME_STORAGE_KEY)
      .then((stored) => {
        if (!cancelled && isThemePreference(stored)) {
          setPreferenceState(stored);
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

  const setPreference = (next: ThemePreference) => {
    setPreferenceState(next);
    AsyncStorage.setItem(THEME_STORAGE_KEY, next).catch(() => undefined);
  };

  const resolvedTheme: ResolvedTheme = preference === 'system' ? (systemScheme === 'dark' ? 'dark' : 'light') : preference;

  const value = useMemo<ThemeContextValue>(
    () => ({
      preference,
      resolvedTheme,
      tokens: tokensFor(resolvedTheme),
      setPreference,
    }),
    [preference, resolvedTheme],
  );

  // Avoid a flash of the wrong theme while the stored preference is still loading:
  // render nothing meaningful (Slot mounts screens as soon as providers resolve).
  if (!hydrated) {
    return null;
  }

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);

  if (!value) {
    throw new Error('useTheme must be used inside ThemeProvider.');
  }

  return value;
}

export function useThemeTokens(): ThemeTokens {
  return useTheme().tokens;
}
