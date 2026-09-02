import type { TranslationKey } from '../../../lib/i18n/translations';

/**
 * The client-side completion trigger state machine (§10/§17 of the milestone
 * spec). Pure and RN-agnostic on purpose — the only piece of the completion
 * flow that's directly unit-testable under the plain node:test harness; the
 * hook that wires it to the real network call (use-lesson-completion.ts) and
 * the screens that fire `trigger()` off a real player/viewer event are not.
 *
 * 'idle'    — no completion attempt made yet, and this lesson wasn't already
 *             COMPLETED when the screen loaded.
 * 'saving'  — a completion POST is in flight.
 * 'saved'   — the backend has confirmed COMPLETED, either from this attempt's
 *             own response, from Course Detail already showing COMPLETED at
 *             mount, or from a post-ambiguity reconciliation read. Terminal:
 *             once reached, `trigger` becomes a no-op (see
 *             `shouldAttemptCompletion`) — the one authoritative state this
 *             machine never leaves once earned.
 * 'error'   — a definitive rejection, or an unresolved ambiguous failure.
 *             Never a "fake completed" state; `errorKey` carries the exact
 *             honest copy to show, and a retry (another `trigger` call) is
 *             always available from here.
 */
export type CompletionPhase = 'idle' | 'saving' | 'saved' | 'error';

export type CompletionState = {
  phase: CompletionPhase;
  errorKey: TranslationKey | null;
};

export type CompletionEvent =
  // A qualifying player/viewer event fired, or the student tapped retry.
  | { type: 'trigger' }
  // The completion POST resolved successfully (always COMPLETED — see
  // completion-client.ts).
  | { type: 'succeeded' }
  // The completion POST was definitively rejected by a reachable backend.
  | { type: 'failed'; errorKey: TranslationKey }
  // The completion POST failed in a way that never reached, or never heard
  // back from, the backend (ApiError kind 'network') — the server may or may
  // not have committed. Distinct from 'failed': the copy this carries must
  // never claim the attempt definitely failed (see completion-error-mapping.ts's
  // 'courses.completion.error.ambiguous').
  | { type: 'ambiguous' }
  // A reconciliation read (after 'ambiguous', or Course Detail already
  // showing COMPLETED at mount) confirmed the backend's truth is COMPLETED.
  | { type: 'confirmedComplete' };

const AMBIGUOUS_ERROR_KEY: TranslationKey = 'courses.completion.error.ambiguous';

export function initialCompletionState(alreadyCompleted: boolean): CompletionState {
  return alreadyCompleted ? { phase: 'saved', errorKey: null } : { phase: 'idle', errorKey: null };
}

/**
 * `shouldAttemptCompletion` is deliberately enforced INSIDE the 'trigger' case
 * itself (not just by a caller-side ref check) so this duplicate-suppression
 * guarantee is provable directly against the pure reducer: a 'trigger' event
 * while 'saving' or already 'saved' returns the identical state, never
 * re-entering 'saving' or spawning a second attempt.
 */
export function reduceCompletionEvent(state: CompletionState, event: CompletionEvent): CompletionState {
  switch (event.type) {
    case 'trigger':
      return shouldAttemptCompletion(state) ? { phase: 'saving', errorKey: null } : state;
    case 'succeeded':
      return { phase: 'saved', errorKey: null };
    case 'failed':
      return { phase: 'error', errorKey: event.errorKey };
    case 'ambiguous':
      return { phase: 'error', errorKey: AMBIGUOUS_ERROR_KEY };
    case 'confirmedComplete':
      return { phase: 'saved', errorKey: null };
    default:
      return state;
  }
}

/** True while a 'trigger' event would actually start a new completion attempt. */
export function shouldAttemptCompletion(state: CompletionState): boolean {
  return state.phase !== 'saving' && state.phase !== 'saved';
}
