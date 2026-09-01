"use client";

import { I18nProvider } from "@/lib/i18n/i18n";
import { ThemeProvider } from "@/lib/theme/theme";
import type { ReactNode } from "react";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <I18nProvider>{children}</I18nProvider>
    </ThemeProvider>
  );
}
