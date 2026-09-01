"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { getAuthService } from "@/lib/api/session";
import type { CurrentUser } from "@/lib/api/types";

/**
 * Platform Admin's own session lifecycle - deliberately separate from
 * `InstructorSessionState`/`InstructorSessionProvider` (features/instructor/
 * session-context.tsx) rather than a shared/parameterized provider, so
 * Instructor Web's approved session code never has to change to accommodate
 * a second role. There is no `tenant` here: Platform Admin is not
 * tenant-scoped (see AuthService.bootstrapAdmin).
 */
export type AdminSessionState =
  | { status: "bootstrapping" }
  | { status: "authenticated"; user: CurrentUser }
  | { status: "api-unavailable" }
  | { status: "expired" }
  | { status: "forbidden" };

export type AdminSessionContextValue = {
  session: AdminSessionState;
  /** Re-runs bootstrap in place (e.g. after a transient API outage). Does not navigate. */
  retry: () => void;
  logout: () => Promise<void>;
};

const AdminSessionContext = createContext<AdminSessionContextValue | null>(null);

/**
 * Owns the authenticated Platform Admin application's session lifecycle:
 * token bootstrap, current user, and logout. Mounted once by
 * apps/web/src/app/admin/layout.tsx, which Next.js keeps alive across every
 * child route under /admin - so this effect runs once per authenticated
 * application entry (or on explicit retry), never again just because the
 * pathname changed.
 */
export function AdminSessionProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [session, setSession] = useState<AdminSessionState>({ status: "bootstrapping" });
  const [attempt, setAttempt] = useState(0);
  const [trackedAttempt, setTrackedAttempt] = useState(attempt);

  // Reset to "bootstrapping" as soon as a retry is requested, during render
  // rather than inside the effect below (React's documented pattern for
  // resetting state when a value changes).
  if (trackedAttempt !== attempt) {
    setTrackedAttempt(attempt);
    setSession({ status: "bootstrapping" });
  }

  useEffect(() => {
    let cancelled = false;

    getAuthService()
      .bootstrapAdmin()
      .then((snapshot) => {
        if (cancelled) {
          return;
        }

        if (snapshot.status === "authenticated" && snapshot.user) {
          setSession({ status: "authenticated", user: snapshot.user });
          return;
        }

        if (snapshot.status === "anonymous") {
          router.replace("/admin/login");
          return;
        }

        if (snapshot.status === "api-unavailable" || snapshot.status === "expired" || snapshot.status === "forbidden") {
          setSession({ status: snapshot.status });
          return;
        }

        // Defensive fallback only: an "authenticated" snapshot missing a user
        // should never happen, but the shell must still resolve to a
        // definite, typed state rather than hang.
        setSession({ status: "forbidden" });
      })
      .catch(() => {
        if (!cancelled) {
          setSession({ status: "api-unavailable" });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [router, attempt]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  const logout = useCallback(async () => {
    await getAuthService().logout();
    router.replace("/admin/login");
  }, [router]);

  const value: AdminSessionContextValue = { session, retry, logout };

  return <AdminSessionContext.Provider value={value}>{children}</AdminSessionContext.Provider>;
}

export function useAdminSession(): AdminSessionContextValue {
  const value = useContext(AdminSessionContext);

  if (!value) {
    throw new Error("useAdminSession must be used inside AdminSessionProvider.");
  }

  return value;
}

/**
 * Convenience hook for pages that only ever render once the shell has
 * already confirmed an authenticated session (every page under /admin/* is
 * - see shell.tsx, which renders {children} exclusively inside the
 * "authenticated" branch).
 */
export function useAuthenticatedAdminSession(): { user: CurrentUser; logout: () => Promise<void> } {
  const { session, logout } = useAdminSession();

  if (session.status !== "authenticated") {
    throw new Error("useAuthenticatedAdminSession used outside an authenticated admin session.");
  }

  return { user: session.user, logout };
}
