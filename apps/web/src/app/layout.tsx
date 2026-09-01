import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Edvora",
  description: "Edvora instructor web workspace.",
};

// Runs before hydration so a returning instructor with an explicit
// light/dark choice never sees a flash of the wrong theme: it reads the
// same localStorage key theme.tsx owns and, only for an explicit choice,
// stamps the data-theme attribute the token cascade in tokens.css keys off
// of. "system" (or nothing stored yet) is left alone entirely - the
// prefers-color-scheme media query in tokens.css already renders the right
// theme for that case with no JS involved, and stamping an attribute here
// would just fight ThemeProvider's own effect on mount.
const THEME_INIT_SCRIPT = `!function(){try{var t=localStorage.getItem("edvora.web.theme");if(t==="light"||t==="dark"){document.documentElement.setAttribute("data-theme",t)}}catch(e){}}()`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
