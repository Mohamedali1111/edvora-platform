export type ResolvedTheme = 'light' | 'dark';

export type ThemeTokens = {
  background: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  text: string;
  textMuted: string;
  primary: string;
  primaryText: string;
  danger: string;
  dangerSurface: string;
  success: string;
  successSurface: string;
  warning: string;
  warningSurface: string;
  overlay: string;
};

// Central token set. Screens must read colors from here (via useThemeTokens) rather
// than hardcoding hex values, so light/dark stay a single source of truth.
export const lightTokens: ThemeTokens = {
  background: '#f7f7f8',
  surface: '#ffffff',
  surfaceAlt: '#f0f1f3',
  border: '#e2e3e7',
  text: '#16181d',
  textMuted: '#6b7078',
  primary: '#2f5bea',
  primaryText: '#ffffff',
  danger: '#c8322b',
  dangerSurface: '#fbe9e8',
  success: '#1c8a52',
  successSurface: '#e6f5ec',
  warning: '#a05a05',
  warningSurface: '#fdf1de',
  overlay: 'rgba(15, 17, 21, 0.5)',
};

export const darkTokens: ThemeTokens = {
  background: '#0f1115',
  surface: '#181b21',
  surfaceAlt: '#20242c',
  border: '#2c313b',
  text: '#f1f2f4',
  textMuted: '#9298a3',
  primary: '#6d8dff',
  primaryText: '#0f1115',
  danger: '#ff6b64',
  dangerSurface: '#3a1c1c',
  success: '#4fd18b',
  successSurface: '#123123',
  warning: '#f2b45c',
  warningSurface: '#3a2c11',
  overlay: 'rgba(0, 0, 0, 0.6)',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
};

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
};

export function tokensFor(theme: ResolvedTheme): ThemeTokens {
  return theme === 'dark' ? darkTokens : lightTokens;
}
