import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/api/errors';
import { useContentAccessRecovery } from '../use-content-access-recovery';
import { completeLesson, isLessonCompleted } from './completion-client';
import { mapCompletionError } from './completion-error-mapping';
import { initialCompletionState, reduceCompletionEvent, type CompletionPhase } from './completion-state';
import type { TranslationKey } from '@/lib/i18n/translations';

export type UseLessonCompletionResult = {
  phase: CompletionPhase;
  errorKey: TranslationKey | null;
  /**
   * Fires the completion attempt. Safe to call from a duplicate/repeated
   * player-end or document-rendered event, from a foreground transition, or
   * from a React re-render: the pure `shouldAttemptCompletion` guard (already
   * COMPLETED, or an attempt already in flight) is checked both here (a
   * synchronous ref check, so two calls in the same tick never both start a
   * network request) and inside the reducer itself. Also serves as the
   * "retry" action from an 'error' state — a plain repeated call.
   */
  trigger: () => void;
};

/**
 * The one hook every completion-capable lesson screen (VIDEO, DOCUMENT) uses
 * to fire and track a `POST .../complete` mutation — see the milestone
 * spec's §6 ("Completion Client") and §10 ("Idempotency / Race Safety").
 * QUIZ never uses this (see quiz/quiz-lesson-screen.tsx).
 *
 * `alreadyCompleted` must be derived from the current Course Detail read
 * (`lesson.progress.status === 'COMPLETED'`) by the caller — this hook never
 * fetches Course Detail itself to decide its own starting state, matching the
 * app-wide rule that Course Detail is the sole source of entitlement/progress
 * truth. When it flips to `true` on ANY render (already true at mount, or
 * becoming true later because a fresh Course Detail read the caller performed
 * for its own reasons says so), this hook converges to 'saved' and never
 * attempts a completion call — "if lesson was already COMPLETED ... do not
 * unnecessarily call complete again."
 */
export function useLessonCompletion(input: {
  courseId: string;
  lessonId: string;
  alreadyCompleted: boolean;
}): UseLessonCompletionResult {
  const recoverFromContentError = useContentAccessRecovery();
  const [state, setState] = useState(() => initialCompletionState(input.alreadyCompleted));

  // Two guards working together, not one: `confirmedRef` is the durable
  // "never attempt again" latch (mirrors the reducer's own 'saved' terminal
  // state, checked synchronously so a burst of events in the same tick can't
  // slip past React's async setState batching); `inFlightRef` additionally
  // blocks a second concurrent attempt while one is still pending, before its
  // resolution has updated `confirmedRef` or `state` at all.
  const confirmedRef = useRef(input.alreadyCompleted);
  const inFlightRef = useRef(false);
  const courseIdRef = useRef(input.courseId);
  const lessonIdRef = useRef(input.lessonId);

  useEffect(() => {
    courseIdRef.current = input.courseId;
    lessonIdRef.current = input.lessonId;
  });

  useEffect(() => {
    if (input.alreadyCompleted && !confirmedRef.current) {
      confirmedRef.current = true;
      setState((previous) => reduceCompletionEvent(previous, { type: 'confirmedComplete' }));
    }
    // `alreadyCompleted` can only ever flip false -> true in practice (Course
    // Detail progress is never downgraded — see
    // StudentCourseAccessService.upsertCompletedProgress); this effect is a
    // no-op on every other render.
  }, [input.alreadyCompleted]);

  const trigger = useCallback(() => {
    if (confirmedRef.current || inFlightRef.current) {
      return;
    }

    const courseId = courseIdRef.current;
    const lessonId = lessonIdRef.current;

    inFlightRef.current = true;
    setState((previous) => reduceCompletionEvent(previous, { type: 'trigger' }));

    completeLesson(courseId, lessonId)
      .then(() => {
        inFlightRef.current = false;
        confirmedRef.current = true;
        setState((previous) => reduceCompletionEvent(previous, { type: 'succeeded' }));
      })
      .catch((error: unknown) => {
        inFlightRef.current = false;
        recoverFromContentError(error);

        if (error instanceof ApiError && error.kind === 'network') {
          // Network-kind failure: the request may or may not have reached/
          // committed on the backend. Never claim it definitely failed —
          // reconcile against Course Detail's own authoritative truth first
          // (see the milestone spec's "Network Ambiguity" section).
          isLessonCompleted(courseId, lessonId)
            .then((completed) => {
              if (completed) {
                confirmedRef.current = true;
                setState((previous) => reduceCompletionEvent(previous, { type: 'confirmedComplete' }));
              } else {
                setState((previous) => reduceCompletionEvent(previous, { type: 'ambiguous' }));
              }
            })
            .catch((reconciliationError: unknown) => {
              // The reconciliation read itself failed (e.g. still offline, or
              // session/device became invalid in the meantime) — still
              // unresolved, same honest "couldn't confirm" state. Also routed
              // through content-access-recovery in case THIS failure (unlike
              // the original network one) is itself an auth/device rejection.
              recoverFromContentError(reconciliationError);
              setState((previous) => reduceCompletionEvent(previous, { type: 'ambiguous' }));
            });
          return;
        }

        setState((previous) => reduceCompletionEvent(previous, { type: 'failed', errorKey: mapCompletionError(error) }));
      });
  }, [recoverFromContentError]);

  return { phase: state.phase, errorKey: state.errorKey, trigger };
}
