# Quiz Attempts (Slices C & D)

This document describes the implemented behavior of student Quiz Attempts: creation, immutable
snapshotting, answer submission, server-side scoring (Slice C), and the resulting Quiz Lesson
`LessonProgress` completion (Slice D). It covers only what is actually implemented — see
`docs/BACKEND-DOMAIN.md` (Quiz Model and Historical Integrity) and `docs/DECISIONS.md` (DEC-0025)
for the originating design decisions this implementation follows.

## Scope

Implemented: starting an attempt, reading the authenticated student's own attempt, saving/changing
an answer while an attempt is open, submitting/finalizing an attempt, server-side scoring, and
automatic Quiz Lesson `LessonProgress` completion on a qualifying finalized attempt (see "Quiz
Lesson completion" below).

Not implemented (explicitly out of scope): aggregate Course completion percentages, attempt
result/review UI, frontend/mobile, randomization, and an abandonment API (nothing in this codebase
ever produces `QuizAttemptStatus.ABANDONED`).

The passing threshold used to compute `passed` is **frozen when the attempt starts** and grading
never consults the live `Quiz` threshold — see "Passing-threshold snapshot" below.

## Routes

All routes are nested under the Slice B Quiz-content-delivery path, never a bare
`/student/quiz-attempts/:attemptId` — an Attempt can only ever be reached through the exact
authorized Course/Lesson/Quiz chain it was started from, reusing
`StudentCourseAccessService.assertAccessibleQuizLesson` on every single request (re-checked fresh
each time, never cached from a prior call):

- `POST /student/courses/:courseId/lessons/:lessonId/quiz/attempts` — start an attempt.
- `GET /student/courses/:courseId/lessons/:lessonId/quiz/attempts/:attemptId` — read one attempt.
- `PUT /student/courses/:courseId/lessons/:lessonId/quiz/attempts/:attemptId/answers/:questionId` —
  save/change an answer (body: `{ optionId: string }`).
- `POST /student/courses/:courseId/lessons/:lessonId/quiz/attempts/:attemptId/submit` — finalize.

## Attempt lifecycle

An attempt has exactly two states reachable by this API: `IN_PROGRESS` (created by start, mutable
via answer writes) and `GRADED` (created by submit, permanently immutable thereafter). The schema
also defines `SUBMITTED` and `ABANDONED`, but this slice never produces them: since every V1
`QuestionType` (`MULTIPLE_CHOICE`, `TRUE_FALSE`) is auto-gradable (no free-response/manual-grading
type exists), there is no reason for a "submitted but not yet graded" resting state — submission
and scoring happen in the same atomic transaction, so `submittedAt` and `gradedAt` are always
stamped with the identical timestamp and the status moves directly `IN_PROGRESS -> GRADED`.
`ABANDONED` (e.g. for a future time-limit/expiry feature) is not produced by anything in this
slice.

## Snapshot behavior (historical integrity)

Starting an attempt atomically creates the `QuizAttempt` row and one `QuizAttemptAnswer` row per
currently-`ACTIVE` Question on the Quiz (never `ARCHIVED` — an archived Question can never enter a
new attempt). Each row freezes, from live authoring state read at that exact instant only:

- `questionSnapshot`: `{ questionId, type, prompt, position }`
- `optionsSnapshot`: every current Option's `{ optionId, label, text, position }`
- `correctAnswerSnapshot`: `{ correctOptionIds: string[] }` — backend-only (see "Reveal behavior")
- `pointsPossible`: the Question's `points` at that instant

The same start transaction also freezes one attempt-level (not per-question) value directly onto
the `QuizAttempt` row itself: `passingScorePercentSnapshot`, a copy of `Quiz.passingScorePercent`
at that instant — see "Passing-threshold snapshot" below.

After this point, nothing about the attempt is ever re-derived from live `Question`/
`QuestionOption`/`Quiz` rows again. An instructor editing a Question's prompt, an Option's text,
which Option is marked correct, or the Quiz's passing threshold has **zero effect** on any attempt
already in progress or already graded — both what is displayed and how the attempt is scored come
exclusively from each attempt's own frozen data. This is proven directly by PostgreSQL tests that
perform each of these edits after an attempt starts and show the attempt's response and its
eventual score/pass-fail are unaffected.

## Scoring (source of truth)

Scoring happens once, inside the atomic submit transaction, and is derived **strictly** from the
attempt's own frozen `QuizAttemptAnswer` rows — never from live `Question`/`QuestionOption` state:

- Points available per question = that row's frozen `pointsPossible`.
- An unanswered question, or one whose saved selection does not exactly match
  `correctAnswerSnapshot.correctOptionIds`, awards **zero points** — there is no partial credit and
  no negative marking.
- A matching selection awards the full frozen `pointsPossible`.
- Total possible points (`maxPoints`) = the sum of every frozen `pointsPossible` in the attempt.
- Score (`scorePoints`) = the sum of every row's computed `pointsAwarded`.
- Percentage = `scorePoints / maxPoints * 100`, computed at **read time** from the two persisted
  values (never stored separately, so it can never drift from them); `null` only in the edge case
  where `maxPoints` is zero.
- `passed` is computed exclusively from `QuizAttempt.passingScorePercentSnapshot` — the threshold
  frozen when this specific attempt started — and the live `Quiz.passingScorePercent` is never
  read at grading time. See "Passing-threshold snapshot" below. If the snapshot is `null` (the
  Quiz had no `passingScorePercent` configured when the attempt started), `passed` is `null` —
  there is no threshold to evaluate against.

All arithmetic uses `Prisma.Decimal` throughout — never native JavaScript floating-point — to avoid
rounding error in authoritative score/percentage values.

A Quiz with zero `ACTIVE` Questions cannot be started at all (`QUIZ_HAS_NO_ACTIVE_QUESTIONS`, 409):
neither `docs/PRODUCT.md` nor `docs/BACKEND-DOMAIN.md` define behavior for an empty quiz, and a
`maxPoints`-zero attempt has no sensible score, so this is the conservative choice rather than an
invented one.

## Passing-threshold snapshot

`QuizAttempt.passingScorePercentSnapshot` (`Decimal? @db.Decimal(5, 2)` — mirrors
`Quiz.passingScorePercent`'s datatype and nullability exactly) is populated once, inside
`startAttempt`'s existing atomic transaction, from the live `Quiz.passingScorePercent` at that
exact instant, alongside the existing per-question snapshot writes. It is never accepted from the
client. `submitAttempt` computes `passed` exclusively from this frozen column — the live `Quiz` row
is never read for grading purposes. Consequently:

- An instructor changing the live threshold **after** an attempt has started has zero effect on
  that attempt's eventual `passed` result, in either direction: raising the threshold cannot make
  an in-progress attempt newly fail, and lowering it cannot make one newly pass.
- A **new** attempt started after the change correctly captures the new threshold.
- If the live `Quiz.passingScorePercent` is `null` when an attempt starts, the snapshot is `null`
  too — `null` is a meaningful, preserved value, never silently replaced by re-reading live state
  later.

This was previously identified as a schema gap (no field existed to freeze the threshold, and
`QuizAttemptAnswer`'s JSON snapshot fields are documented, `docs/BACKEND-DOMAIN.md`/DEC-0025, as
per-question data only — not a valid home for quiz-level grading configuration). It has now been
resolved with one additive, nullable column; see "Migration" below.

### Historical rows / null semantics

Because the column is nullable with no backfill, a hypothetical pre-migration `QuizAttempt` row
(one that predates this column existing) would read `passingScorePercentSnapshot` as `null` even
if the Quiz had a real threshold configured when that attempt actually started — there is no way to
reconstruct that historical value. This is **not** treated as a special case: it collapses into the
exact same, already-defined `passed = null` ("no threshold to evaluate against") semantics used for
a Quiz that genuinely has no `passingScorePercent` configured. This is the deliberate, fail-safe
choice: a student's result is never silently graded against a threshold that cannot be proven to be
the one in effect when they started, and it requires no extra code, migration-era branching, or
"was this row created before or after the migration" detection — none of which is warranted given
this project is pre-production and every test/validation database is disposable.

## Migration

`prisma/migrations/20260830000000_add_quiz_attempt_passing_threshold_snapshot/migration.sql`
contains exactly one statement:

```sql
ALTER TABLE "quiz_attempts" ADD COLUMN     "passing_score_percent_snapshot" DECIMAL(5,2);
```

Nullable, no default, no constraint — additive only. It does not modify or drop any existing
column, does not touch any other table, and (per PostgreSQL's own `ADD COLUMN` semantics for a
nullable column with no default) is a fast, metadata-only operation that never rewrites existing
row data, so it is safe regardless of how many `quiz_attempts` rows already exist.

## Attempt-limit semantics — implemented (V1 rule)

`attemptLimit` is the maximum number of attempts **successfully started** by a student for a Quiz
**within the current Enrollment**, scoped by `(studentUserId, enrollmentId, quizId)`. Every
successfully-created attempt counts toward it regardless of status — `IN_PROGRESS`, `GRADED`, or a
future `ABANDONED` — specifically so that abandoning an attempt can never restore or evade
allowance. `attemptLimit === null` means unlimited, matching the schema's own nullability
(`docs/DATABASE-DESIGN.md`: "attemptLimit nullable"); no other "unlimited" sentinel exists or was
invented. Re-attempting under a *different* Enrollment (e.g. after re-enrollment) starts a fresh
allowance — the limit is deliberately per-Enrollment, not lifetime-per-student, per the V1 product
decision. `attemptNumber` itself remains scoped only to `(quizId, studentUserId)`, per the schema's
own unique constraint, and is unaffected by the per-Enrollment limit count.

Enforcement happens inside `startAttempt`'s existing `(studentUserId, quizId)` transaction-scoped
advisory lock (no new lock scope introduced): the live `Quiz.attemptLimit` is read, and if not
`null`, the current count for `(studentUserId, enrollmentId, quizId)` is compared against it before
any attempt row is created. Exceeding the limit raises a clean domain error
(`QuizAttemptLimitReachedError` → `QUIZ_ATTEMPT_LIMIT_REACHED`, 409) — never a raw Prisma/database
failure. Because the count-then-create sequence is serialized by the same lock already used for
`attemptNumber` assignment, two concurrent start requests with exactly one slot remaining cannot
both succeed: the first to acquire the lock creates the attempt and commits; the second re-reads
the now-updated count inside its own transaction and is correctly rejected. Proven directly against
persisted database state — the final attempt count for a limited Quiz/Enrollment never exceeds the
configured limit under a real concurrent race.

## Quiz Lesson completion (V1 rule)

**A `GRADED` attempt completes its Quiz Lesson automatically when the attempt has no
passing-threshold snapshot, or when a configured-threshold attempt has `passed === true`. Failed
threshold-based attempts do not complete or downgrade progress.** Precisely, using only the
already-persisted attempt result — never a separate recalculation, and never live `Quiz` state:

```text
attempt.status === GRADED
AND (attempt.passingScorePercentSnapshot === null OR attempt.passed === true)
```

- **No threshold configured** (`passingScorePercentSnapshot === null`): an ungraded/practice Quiz.
  Any successfully `GRADED` attempt qualifies — `passed` is legitimately `null` in this case (no
  threshold to evaluate), and that is not treated as "not qualifying."
- **Threshold configured**: only `passed === true` qualifies. A failed attempt never creates or
  downgrades progress; the Lesson simply keeps whatever state it already had (including staying
  `NOT_STARTED`/absent, if no prior attempt ever passed).

This is the *only* authoritative path to Quiz Lesson completion — there is no separate student
Quiz-completion endpoint, and `POST /student/courses/:courseId/lessons/:lessonId/complete` (the
generic manual-completion endpoint) continues to reject `QUIZ` lessons unconditionally, exactly as
before Slice D.

### Atomicity

The qualification check and, when it qualifies, the `LessonProgress` transition both happen inside
`submitAttempt`'s existing single database transaction — the same transaction that grades and
finalizes the attempt (`status -> GRADED`, `scorePoints`/`maxPoints`/`passed` persisted). There is
no committed state where a qualifying attempt is finalized but its progress transition didn't
happen, or vice versa: both commit together, or (on any error) both roll back together. No new
transaction boundary or lock scope was introduced — this reuses the attempt's own existing
`quiz-attempt:{attemptId}` per-attempt advisory lock.

An already-`GRADED` attempt's repeat submit takes the existing idempotent short-circuit path
(returns the stable persisted result) and deliberately does **not** re-run the completion check:
the qualifying decision was already made correctly in the attempt's one grading transaction, and
the progress upsert below is itself idempotent, so nothing would change on a repeat besides wasted
work. No repair/backfill semantics were introduced.

### Progress transitions and ownership

Ownership is entirely server-derived from the same proof `submitAttempt` already required to act
on the attempt at all — never client-supplied:

- `studentUserId` = `principal.userId`
- `lessonId` = the authorized Quiz Lesson from the route (`assertAccessibleQuizLesson`)
- `enrollmentId` = the value `assertAccessibleQuizLesson` resolved for this exact request

Transitions reuse the existing `(studentUserId, lessonId, enrollmentId)` unique identity and the
existing progress semantics: a missing row is created `COMPLETED`; an existing `NOT_STARTED` or
`STARTED` row transitions to `COMPLETED`; an existing `COMPLETED` row is left completely stable —
`completedAt` is stamped with `ClockService.now()` (the same `now` value used for the attempt's
own `submittedAt`/`gradedAt`) only on the *first* transition to `COMPLETED`, never restamped after.
Progress is never downgraded (`COMPLETED -> STARTED/NOT_STARTED` never happens).

### Race safety: two different attempts completing the same Lesson

Because two *different* `QuizAttempt`s for the same Quiz Lesson each run in their own transaction
behind their own per-attempt advisory lock, they can be submitted genuinely concurrently — the
per-attempt lock does not serialize them against each other. `upsertCompletedProgress`
(`StudentCourseAccessService`, reused rather than duplicated — see below) handles this with a
single native PostgreSQL `INSERT ... ON CONFLICT ("student_user_id", "lesson_id",
"enrollment_id") DO UPDATE ... WHERE status <> 'COMPLETED'` statement: the conflict/no-op case is
handled entirely inside PostgreSQL for one statement and never raises an application-level
exception, so it is safe to call from within an already-open transaction (unlike the create-then
catch-unique-violation pattern used elsewhere in this codebase — see the code comment on
`upsertCompletedProgress` for why that pattern was not reused here: a caught exception does not
roll a PostgreSQL transaction back to a safe point, so continuing to issue statements in the same
transaction after catching one would fail). This was proven with a dedicated PostgreSQL test:
starting two attempts, then submitting both concurrently, converges to exactly one `COMPLETED`
`LessonProgress` row with a stable `completedAt`, while both `QuizAttempt`s still grade and
finalize independently and successfully.

## Reveal behavior — conservative, documented decision

DEC-0025 states correct-answer snapshots are backend-only and "must not be exposed before the
reveal policy allows it," but `Quiz.revealAnswersPolicy`'s exact semantics (`NEVER`,
`AFTER_SUBMISSION`, `AFTER_PASSING`) are not defined anywhere in this repository beyond the enum
names themselves — `docs/DATABASE-CONSTRAINTS.md` explicitly notes "reveal policy... remain[s]
application-controlled" with no further specification. Per this slice's instructions, the
conservative choice was made: **no per-question correctness or correct-Option data is ever
exposed by this API, before or after submission**, regardless of `revealAnswersPolicy`'s value.
Only the aggregate `result` (`scorePoints`, `maxPoints`, `percentage`, `passed`, `gradedAt`) is
revealed, and only once an attempt is `GRADED`. Implementing the actual per-policy reveal behavior
is deferred until `revealAnswersPolicy`'s semantics are explicitly documented.

Defense in depth: the Prisma `select` used by every read/write response path never even loads
`correctAnswerSnapshot`, `pointsAwarded`, or `pointsPossible` into memory. A separate, narrower
scoring-only query inside `submitAttempt` is the *only* place in the service that selects
`correctAnswerSnapshot`, and its result never feeds a student-facing response — so a mapping bug
cannot leak answer-key or per-question scoring data even in principle.

## Idempotency

- **Answer retry**: saving the same answer repeatedly never creates a duplicate row — the write
  always `update`s the one pre-existing `QuizAttemptAnswer` row for `(attemptId, questionId)`
  (created at attempt start), never `insert`s.
- **Answer change**: while an attempt is `IN_PROGRESS`, re-saving a different `optionId` for the
  same question simply updates that same row again.
- **Submit retry**: submitting an already-`GRADED` attempt returns the stable persisted result
  unchanged — never rescored, never re-stamped (`submittedAt`/`gradedAt` keep their original
  values).
- **Concurrent submit**: multiple simultaneous submit requests for the same attempt converge to
  exactly one persisted final result (proven directly against the database, and by asserting every
  concurrent response is byte-identical).
- **Progress completion (Slice D)**: repeated submit of an already-`GRADED` qualifying attempt
  never duplicates the `LessonProgress` row or restamps `completedAt`; concurrent submits of the
  *same* attempt converge to one row via the per-attempt lock; concurrent qualifying submits of
  *different* attempts for the same Lesson converge to one row via the native `ON CONFLICT`
  upsert (see "Quiz Lesson completion" above) — no global lock.

## Concurrency / locking strategy

Two independently-scoped, transaction-scoped PostgreSQL advisory locks
(`pg_advisory_xact_lock(hashtextextended(...))`) — the same pattern already established by
`StudentDeviceService.lockStudentDeviceState` and `QuestionOptionService`'s per-question lock —
serialize the write surface, each with a distinct string-prefixed key namespace so the three lock
scopes used across this codebase cannot collide:

- `quiz-attempt-start:{studentUserId}:{quizId}` — held while starting an attempt, so two
  concurrent start requests cannot compute the same next `attemptNumber` and collide on the
  `(quizId, studentUserId, attemptNumber)` unique constraint. The same lock also serializes
  `attemptLimit` enforcement's count-then-create sequence (see "Attempt-limit semantics"), so two
  concurrent start requests with one slot remaining cannot both succeed.
- `quiz-attempt:{attemptId}` — held by **both** answer writes and submission, so the two can never
  interleave for the same attempt. Whichever transaction commits second re-reads the true
  post-commit state of the first inside its own transaction: an answer write that loses the race
  against a submit sees the attempt already `GRADED` and is rejected
  (`QUIZ_ATTEMPT_NOT_OPEN`, 409) rather than silently writing into a finalized attempt; a submit
  that loses the race against an answer write sees the freshly-saved answer and correctly scores
  it. This is proven directly against persisted database state for both possible orderings of a
  genuine concurrent race, not just asserted for one assumed ordering.

These are a PostgreSQL implementation detail of this API service, not a cross-database portability
promise.

## Ownership / IDOR

Every read and write proves attempt ownership via `(tenantId, quizId, lessonId, studentUserId,
attemptId)`, all derived server-side from the authenticated principal and the already-authorized
Course/Lesson chain — never accepted as client-supplied values. A foreign/random Attempt ID and
another student's real Attempt both collapse to the same `QuizAttemptNotFoundError` (404),
matching this codebase's established IDOR-avoidance convention (no existence leakage between
"does not exist" and "exists but is not yours").
