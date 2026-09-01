/**
 * Presentation-only helpers for the Progress/Quiz Results reporting page.
 * Every function here is a pure passthrough/format of a value the backend
 * already computed - none of them accept a Quiz's current metadata
 * (`passingScorePercent` or similar), so there is no code path in this
 * feature that could recompute a historical pass/fail or percentage.
 */

/** Renders a backend ISO timestamp using the viewer's locale/timezone, including time-of-day. Falls back to the raw string if unparsable, and to a placeholder when null. */
export function formatDateTime(value: string | null, placeholder: string): string {
  if (value === null) {
    return placeholder;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

/**
 * Renders the backend's already-rounded 0-100 `progressPercent` number.
 * Never re-rounds or recomputes it from `completedLessons`/`totalLessons` -
 * the number itself, exactly as returned, is what's shown.
 */
export function formatProgressPercent(value: number): string {
  return `${value}%`;
}

/**
 * Renders the backend's Decimal-as-string `percentage` verbatim (with a `%`
 * suffix) - never parsed back into a `number` and re-formatted, which could
 * silently change the represented precision. `null` (not yet graded) uses
 * `placeholder`.
 */
export function formatAttemptPercentage(value: string | null, placeholder: string): string {
  return value === null ? placeholder : `${value}%`;
}

/**
 * Renders "score / max" from the backend's Decimal-as-string fields exactly
 * as received - both strings concatenated, no numeric parsing of either.
 * `null` (not yet graded) uses `placeholder`.
 */
export function formatAttemptScore(scorePoints: string | null, maxPoints: string | null, placeholder: string): string {
  if (scorePoints === null || maxPoints === null) {
    return placeholder;
  }

  return `${scorePoints} / ${maxPoints}`;
}

export type PassFailPresentation = "passed" | "failed" | "pending";

/**
 * The one place that turns a persisted `QuizAttempt.passed` value into a
 * presentation state. Deliberately takes only `passed` itself - there is no
 * `passingScorePercent`/threshold parameter to accept, so this function
 * structurally cannot derive a result from a Quiz's current metadata. `null`
 * (ungraded) always renders as "pending", never guessed as pass or fail.
 */
export function presentPassFail(passed: boolean | null): PassFailPresentation {
  if (passed === true) {
    return "passed";
  }

  if (passed === false) {
    return "failed";
  }

  return "pending";
}
