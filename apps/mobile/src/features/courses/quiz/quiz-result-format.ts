// Pure display-formatting for the server-authoritative `StudentQuizAttemptResult`
// (see quiz-types.ts) — never a source of the score/percentage/pass-fail values
// themselves, only how the already-persisted decimal strings are shown. Mirrors
// the `never recompute pass/fail on mobile` rule: these functions format, they
// never derive.

/**
 * `scorePoints`/`maxPoints`/`percentage` arrive as decimal strings (the backend
 * serializes `Prisma.Decimal` this way). Trims a trailing `.00`/`.50` -> `.5`
 * style zero for a cleaner display without losing genuine precision.
 */
function formatDecimalString(value: string): string {
  const num = Number(value);

  if (!Number.isFinite(num)) {
    return value;
  }

  if (Number.isInteger(num)) {
    return String(num);
  }

  return num.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

export function formatScoreFraction(scorePoints: string, maxPoints: string): string {
  return `${formatDecimalString(scorePoints)} / ${formatDecimalString(maxPoints)}`;
}

/** `null` only when the attempt has no meaningful percentage (maxPoints was zero) — see quiz-types.ts. */
export function formatPercentageValue(percentage: string | null): string | null {
  if (percentage === null) {
    return null;
  }

  return `${formatDecimalString(percentage)}%`;
}
