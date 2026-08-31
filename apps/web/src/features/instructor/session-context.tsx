"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { getAuthService } from "@/lib/api/session";
import type { CurrentUser, TenantContext } from "@/lib/api/types";

export type InstructorSessionState =
  | { status: "bootstrapping" }
  | { status: "authenticated"; user: CurrentUser; tenant: TenantContext }
  | { status: "api-unavailable" }
  | { status: "expired" }
  | { status: "forbidden" };

export type InstructorSessionContextValue = {
  session: InstructorSessionState;
  /** Re-runs bootstrap in place (e.g. after a transient API outage). Does not navigate. */
  retry: () => void;
  logout: () => Promise<void>;
};

const InstructorSessionContext = createContext<InstructorSessionContextValue | null>(null);

/**
 * Owns the authenticated instructor application's session lifecycle: token
 * bootstrap, current user, tenant context, and logout. Mounted once by
 * apps/web/src/app/instructor/layout.tsx, which Next.js keeps alive across
 * every child route under /instructor - so this effect runs once per
 * authenticated application entry (or on explicit retry), never again just
 * because the pathname changed. The bootstrap effect's dependency array
 * intentionally excludes the pathname; see navigation.ts for the (fully
 * separate) module that resolves the active section from the URL.
 */
export function InstructorSessionProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [session, setSession] = useState<InstructorSessionState>({ status: "bootstrapping" });
  const [attempt, setAttempt] = useState(0);
  const [trackedAttempt, setTrackedAttempt] = useState(attempt);

  // Reset to "bootstrapping" as soon as a retry is requested, during render
  // rather than inside the effect below (React's documented pattern for
  // resetting state when a value changes - see react-hooks/set-state-in-effect).
  if (trackedAttempt !== attempt) {
    setTrackedAttempt(attempt);
    setSession({ status: "bootstrapping" });
  }

  useEffect(() => {
    let cancelled = false;

    getAuthService()
      .bootstrap()
      .then((snapshot) => {
        if (cancelled) {
          return;
        }

        if (snapshot.status === "authenticated" && snapshot.user && snapshot.tenant) {
          setSession({ status: "authenticated", user: snapshot.user, tenant: snapshot.tenant });
          return;
        }

        if (snapshot.status === "anonymous") {
          router.replace("/auth/login");
          return;
        }

        if (snapshot.status === "api-unavailable" || snapshot.status === "expired" || snapshot.status === "forbidden") {
          setSession({ status: snapshot.status });
          return;
        }

        // Defensive fallback only: an "authenticated" snapshot missing user/tenant
        // should never happen, but the shell must still resolve to a definite,
        // typed state rather than hang.
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
    router.replace("/auth/login");
  }, [router]);

  const value: InstructorSessionContextValue = { session, retry, logout };

  return <InstructorSessionContext.Provider value={value}>{children}</InstructorSessionContext.Provider>;
}

export function useInstructorSession(): InstructorSessionContextValue {
  const value = useContext(InstructorSessionContext);

  if (!value) {
    throw new Error("useInstructorSession must be used inside InstructorSessionProvider.");
  }

  return value;
}

/**
 * Convenience hook for pages that only ever render once the shell has
 * already confirmed an authenticated session (every page under
 * /instructor/* is - see shell.tsx, which renders {children} exclusively
 * inside the "authenticated" branch). Throws if that invariant is ever
 * violated, the same defensive pattern useI18n() already uses.
 */
export function useAuthenticatedInstructorSession(): {
  user: CurrentUser;
  tenant: TenantContext;
  logout: () => Promise<void>;
} {
  const { session, logout } = useInstructorSession();

  if (session.status !== "authenticated") {
    throw new Error("useAuthenticatedInstructorSession used outside an authenticated instructor session.");
  }

  return { user: session.user, tenant: session.tenant, logout };
}
