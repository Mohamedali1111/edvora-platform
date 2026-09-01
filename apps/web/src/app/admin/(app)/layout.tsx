import type { ReactNode } from "react";
import { AdminSessionProvider } from "@/features/admin/session-context";
import { AdminShell } from "@/features/admin/shell";

/**
 * Persistent authenticated shell boundary for every /admin/* route (except
 * /admin/login, which renders outside this layout - see app/admin/login/
 * page.tsx). Mirrors apps/web/src/app/instructor/layout.tsx's structure
 * exactly, wired to the Platform Admin session/shell instead.
 */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <AdminSessionProvider>
      <AdminShell>{children}</AdminShell>
    </AdminSessionProvider>
  );
}
