import type { ReactNode } from "react";
import { InstructorSessionProvider } from "@/features/instructor/session-context";
import { InstructorShell } from "@/features/instructor/shell";

/**
 * Persistent authenticated shell boundary for every /instructor/* route.
 * Next.js keeps this layout mounted across sibling route navigations (it
 * only remounts if the whole segment is torn down, e.g. a hard reload), so
 * InstructorSessionProvider's bootstrap effect runs once per authenticated
 * application entry rather than once per section.
 */
export default function InstructorLayout({ children }: { children: ReactNode }) {
  return (
    <InstructorSessionProvider>
      <InstructorShell>{children}</InstructorShell>
    </InstructorSessionProvider>
  );
}
