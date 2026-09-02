import type { ApiClient } from "@/lib/api/client";
import type { ActivateAccountRequest } from "@/lib/api/types";

/**
 * POST /auth/activate for the `INSTRUCTOR_ACTIVATION` purpose (G-01 repair) - the same public,
 * unauthenticated backend contract Student Mobile already calls for `STUDENT_ACTIVATION`
 * (apps/mobile/src/features/auth/auth-client.ts's `activateAccount`); only the purpose value
 * differs. `auth: false` matches how `AuthService.login`/`refreshAccessToken` call every other
 * pre-session endpoint - this request must never carry a Bearer token, since the whole point of
 * this route is that the caller has never signed in. Resolves to `void` on the backend's 204: it
 * never returns a session for this call (see `AuthOrchestrationService.activateAccount`), so the
 * caller must route the instructor to `/auth/login` itself rather than inventing an auto-login.
 */
export function activateInstructorAccount(
  api: ApiClient,
  input: { activationToken: string; newPassword: string },
): Promise<void> {
  const body: ActivateAccountRequest = {
    activationToken: input.activationToken,
    purpose: "INSTRUCTOR_ACTIVATION",
    newPassword: input.newPassword,
  };

  return api.request<void>("/auth/activate", {
    method: "POST",
    auth: false,
    body,
  });
}
