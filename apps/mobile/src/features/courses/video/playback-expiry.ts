// Pure expiry decisions for a backend-issued playback capability — no timer, no
// polling. This app never extends/reconstructs a capability locally; it only
// ever decides WHEN to ask the backend for a fresh one (see use-video-access.ts,
// which calls these only reactively — on a playback error and on foreground
// resume — never on an interval).

/** True once `now` has reached or passed the capability's own `expiresAt`. */
export function isCapabilityExpired(expiresAtIso: string, nowMs: number): boolean {
  const expiresAtMs = Date.parse(expiresAtIso);

  if (Number.isNaN(expiresAtMs)) {
    // An unparseable expiry is treated as already-expired: safer to force a
    // fresh, backend-revalidated capability than to trust a value this client
    // cannot even interpret.
    return true;
  }

  return nowMs >= expiresAtMs;
}

const FOREGROUND_RESUME_SAFETY_MARGIN_MS = 30_000;

/**
 * Used only at the single moment the app returns to the foreground (never on a
 * running timer): if the capability is already expired, or will expire within
 * this safety margin, treat it as needing a fresh one rather than waiting for
 * playback to actually fail mid-resume.
 */
export function needsRefreshOnForegroundResume(expiresAtIso: string, nowMs: number): boolean {
  const expiresAtMs = Date.parse(expiresAtIso);

  if (Number.isNaN(expiresAtMs)) {
    return true;
  }

  return nowMs >= expiresAtMs - FOREGROUND_RESUME_SAFETY_MARGIN_MS;
}
