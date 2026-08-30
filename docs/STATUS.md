# Project Status

## Project

Edvora Platform

## Current Phase

Initial Prisma schema, reviewed PostgreSQL migration artifacts, NestJS Prisma/PostgreSQL runtime foundation, authentication/session security design, V1 account onboarding decisions, auth one-time token persistence, internal auth/security primitives, internal auth use-case orchestration, the first public auth HTTP boundary, student device authorization foundation, tenant-student association design, tenant-student persistence, the first tenancy/enrollment service/API foundation, Instructor Course Core Slice A, Instructor Course Sections/Lessons/Ordering Slice B, Student Course Authorization/Read Slice C, Minimal Lesson Progress Slice D, Instructor Quiz Authoring (Quiz/Question/QuestionOption create/read/update/reorder), Quiz Milestone Slice B (student-safe Quiz content delivery), Quiz Milestone Slice C (student Quiz attempt creation, answer submission, and server-side scoring), Quiz Milestone Slice D (Quiz completion → `LessonProgress` integration), Media Slice A (instructor tenant-scoped VideoAsset/DocumentAsset reads), Media Slice B (the protected student DOCUMENT Lesson runtime authorization boundary), Media Slice C (the protected student VIDEO Lesson runtime playback authorization boundary), Media Slice D (secure R2 document uploads), student R2 document download capability issuance, the Bunny Stream video upload/processing lifecycle, and Media Slice G (protected Bunny video playback capability issuance) are completed. The repository has minimal framework foundations for API, web, and mobile; DRM integration and course lifecycle transitions are not implemented yet.

Current media update: Media Slice D is completed, and the student DOCUMENT Lesson access route issues
a short-lived Cloudflare R2/S3 presigned GET for the finalized READY object. Documents are locked to
Cloudflare R2 and Videos are locked to Bunny Stream Standard Network. The Bunny video upload and
processing lifecycle is implemented, and student VIDEO playback capability issuance is now also
implemented (Media Slice G): the student video access route issues a real, short-lived, path-scoped
Bunny CDN "directory" (path-style) HLS playback URL, not merely Bunny's embed/iframe view token — see
`docs/MEDIA.md` for the full construction, TTL, and IP-binding reasoning.

Current video update: instructor video upload intents create a real Bunny Stream video resource,
persist a truthful `VideoAsset` with `externalAssetRef` set to the Bunny GUID and `providerKey` set
to the Bunny Library ID, then return only the short-lived Bunny TUS upload capability needed for
direct client-to-Bunny upload. Bunny signed webhooks are verified with HMAC-SHA256 over the raw body
and update `VideoAsset` state monotonically. Bunny status `4` remains Edvora `PROCESSING`; only
status `3` becomes Edvora `READY`. Once READY, the student video access route signs a Bunny CDN
directory token scoped to that video's own `/{videoId}/` storage prefix, protecting the HLS manifest
and every segment/quality file together; TTL is derived from the video's own known
`durationSeconds` (clamped to 5 minutes–4 hours, with a bounded fallback when duration is unknown),
and no IP binding is applied (a deliberate V1 reliability choice for MENA mobile networks).

## Completed Work

- Media Slice D is completed: Documents are backed by Cloudflare R2 using the S3-compatible API,
  while the locked video provider is Bunny Stream Standard Network. Instructor document upload now
  uses a server-authorized direct-upload lifecycle: backend-generated `DocumentAsset` ID, short-lived
  direct R2 PUT bearer capability for temporary key
  `tenants/{tenantId}/document-uploads/{documentAssetId}`, client bytes flowing directly to R2,
  backend `HEAD` verification of the temporary object, promotion/copy to final key
  `tenants/{tenantId}/documents/{documentAssetId}`, final verification, and `UPLOADING -> READY`
  only after `DocumentAsset.externalAssetRef` is set to the final key. A reused original PUT can
  only overwrite the temporary key, never the READY asset's final object. Filenames remain metadata
  only. NestJS does not proxy document bytes, R2 credentials/configuration are not exposed to
  clients, and cleanup for abandoned `UPLOADING` assets is deferred.

- Student DOCUMENT Lesson access now issues real short-lived R2 download capabilities after the
  existing `StudentCourseAccessService.assertAccessibleDocumentLesson(...)` entitlement/readiness
  chain succeeds. The capability signs only the finalized READY key
  `tenants/{tenantId}/documents/{documentAssetId}` stored in `DocumentAsset.externalAssetRef`; a
  READY asset still pointing at the temporary upload namespace is rejected rather than signed. The
  response includes only safe display metadata plus `downloadUrl`/`expiresAt`, excludes
  `documentAssetId`, `tenantId`, `externalAssetRef`, provider configuration, credentials, and
  permanent/public URLs, and remains side-effect-free for `LessonProgress`, `QuizAttempt`,
  `Enrollment`, and asset state. Student document bytes flow Cloudflare R2 -> student client, never
  through NestJS. The signed GET is an ephemeral bearer capability, not DRM or piracy prevention.

- Bunny Stream video upload/processing lifecycle is implemented for instructors. The API route
  `POST /instructor/tenants/:tenantId/media/videos/upload-intents` authorizes instructor tenant
  access, creates the Bunny Stream video object, persists a backend-generated `VideoAsset` in
  `UPLOADING`, and returns only Bunny TUS upload headers and endpoint. Video bytes flow instructor
  client -> Bunny Stream, never through NestJS. The provider webhook route
  `POST /provider-webhooks/bunny/stream` is unauthenticated by user credentials and accepts only
  valid Bunny HMAC-SHA256 signatures over the raw request body. Because Bunny v1 signatures have no
  timestamp/replay expiry, state transitions are monotonic and replay-safe: `READY` cannot regress to
  `PROCESSING`, `UPLOADING`, or `FAILED`; duplicate `READY` is safe; unknown provider videos are
  acknowledged as no-op. Status mapping is documented in `docs/MEDIA.md`, including status `4`
  staying non-ready and status `3` becoming `READY`. Student playback capability remains deferred.

- Established root documentation for product, architecture, security, UI, release compliance, reliability, decisions, and future handoffs.
- Established a pnpm workspace monorepo foundation.
- Scaffolded `apps/api` as a minimal NestJS TypeScript application.
- Scaffolded `apps/web` as a minimal Next.js App Router TypeScript application with Tailwind CSS.
- Scaffolded `apps/mobile` as a minimal Expo SDK 57 React Native TypeScript application with Expo Router.
- Designed the V1 backend domain model in `docs/BACKEND-DOMAIN.md`.
- Designed the V1 relational database model in `docs/DATABASE-DESIGN.md`.
- Implemented the initial PostgreSQL Prisma schema in `apps/api/prisma/schema.prisma`.
- Added Prisma CLI/Client tooling to `apps/api` and non-destructive Prisma validation scripts.
- Documented PostgreSQL-only constraints deferred to migrations in `docs/DATABASE-CONSTRAINTS.md`.
- Generated the first reviewed PostgreSQL migration SQL artifact in `apps/api/prisma/migrations/20260823000000_initial_schema/migration.sql`.
- Added migration workflow guidance in `docs/MIGRATIONS.md`.
- Validated the initial migration against a disposable PostgreSQL 16 database, including custom partial indexes, check constraints, tenant composite foreign keys, JSONB fields, and repeatable clean application.
- Added the NestJS API database runtime boundary using Prisma 7, `@prisma/adapter-pg`, and `pg`.
- Added API runtime configuration validation for `DATABASE_URL`, a safe `.env.example`, and focused database infrastructure unit tests.
- Designed V1 authentication/session security in `docs/AUTHENTICATION.md`.
- Finalized V1 managed account creation, account activation, password reset, access-token, and refresh-token decisions.
- Implemented required authentication persistence additions for `AccountActivationToken` and `PasswordResetToken`.
- Added the reviewed additive migration `20260823010000_add_auth_security_tokens` and validated it against disposable PostgreSQL 16 after the initial migration.
- Implemented internal authentication/security primitives for password hashing, JWT access tokens, opaque refresh tokens, refresh-session rotation/revocation, account activation tokens, and password reset tokens.
- Implemented internal authentication use-case orchestration for login, account activation, refresh, logout, logout-all, authenticated password change, and password-reset completion.
- Implemented public auth HTTP routes for login, refresh, logout, logout-all, activation completion, authenticated password change, and password-reset completion.
- Added auth DTO validation, stable auth error mapping, Bearer access-token guard, typed authenticated principal decorator, web refresh cookies, trusted-origin checks, no-store token responses, and initial in-process auth throttling.
- Documented the auth HTTP route contract in `docs/AUTH-HTTP-API.md`.
- Implemented the student device authorization backend foundation, including first-device authorization, existing-device checks, device-change requests, Platform Admin approval/rejection, a reusable `StudentDeviceGuard`, and documented route/security behavior in `docs/DEVICE-AUTHORIZATION.md`.
- Designed and implemented the tenant-student association persistence model in `docs/TENANT-STUDENT-DESIGN.md`, Prisma schema, and the reviewed PostgreSQL migration `20260823020000_add_tenant_student_associations`.
- Implemented the backend tenancy/enrollment foundation for Platform Admin instructor creation/list/detail, instructor tenant context, instructor tenant-scoped student association/list/detail, enrollment create/revoke, and student enrollment reads behind device authorization.
- Documented implemented tenancy/enrollment behavior in `docs/TENANCY-ENROLLMENT.md`.
- Implemented Instructor Course Core Slice A: create course, paginated tenant-scoped course list, course detail, and safe metadata update for title, description, thumbnail asset reference, and visibility.
- Implemented Instructor Course Sections/Lessons/Ordering Slice B: authorized CourseSection create/update-metadata/archive/reorder, generic Lesson create (with exactly one type-matching VideoLesson/DocumentLesson/QuizLesson detail row created atomically, referencing an already-existing tenant-scoped VideoAsset/DocumentAsset/Quiz row) alongside Lesson update-metadata/archive/reorder, all nested-resource ownership proved through Prisma composite keys inherited from the already-authorized parent chain (never a bare-ID lookup followed by trusting a client-supplied parent relationship), and a safe two-phase transactional resequence for whole-list reorder that reassigns the existing active-position value set (not literal `1..N`) to avoid colliding with an archived sibling's retained position under the current non-partial `(courseId, position)` / `(sectionId, position)` unique indexes. Fixed a pre-existing latent bug in the shared `isKnownUniqueViolation` Prisma-error-detection utility (used by both the tenancy and courses modules): under Prisma 7 with `@prisma/adapter-pg`, unique-violation detail is reported under `meta.driverAdapterError.cause`, not the historical `meta.target` shape the utility previously checked; it now checks both. A subsequent focused security/data-integrity review of Slice B found and fixed one further narrow defect: whole-list reorder had no handling for a concurrent same-parent reorder race (e.g. a UI double-submit), unlike create; it now uses the same narrow `isKnownUniqueViolation` catch. The review also ran the existing tenancy PostgreSQL suite (7 tests) to confirm the shared-utility fix caused no regression there.
- Implemented Student Course Authorization/Read Slice C: a new `StudentCourseAccessService` entitlement primitive proving, from current database state only, ACTIVE STUDENT → a currently entitled ACTIVE Enrollment (status plus `startsAt`/`endsAt` time window evaluated against `ClockService.now()`, never mutated as a side effect of the read) → an ACTIVE `TenantStudent` for the course's own tenant (derived from the course, never a client-supplied tenant field) → Course `PUBLISHED` in an ACTIVE tenant. `GET /student/courses` (paginated, bounded, `principal.userId`-scoped) and `GET /student/courses/:courseId` (ordered `PUBLISHED` sections/lessons only, lessons additionally filtered by their `availableFrom`/`availableUntil` window, currently-unavailable lessons omitted entirely rather than exposed as locked metadata) are the first endpoints in this codebase to enforce course-content entitlement. Every rejection reason collapses to the existing `CourseNotFoundError`, so a wrong, foreign, cross-tenant, DRAFT/ARCHIVED, or currently-unentitled course ID is indistinguishable from one that does not exist. Responses use new student-only types, deliberately excluding every instructor-authoring/provider-internal field (asset IDs, provider keys, external references, playback/download URLs, quiz questions/options/answers) the equivalent instructor-facing types expose. No new error types, DTO param shape reuses no client-supplied tenant/student identifiers, and no shared authorization primitives outside the courses module were modified.
- Implemented Minimal Lesson Progress Slice D on top of the Slice C entitlement boundary: `StudentCourseAccessService.getCourseStructure` now includes each returned lesson's `progress` (`NOT_STARTED`/`STARTED`/`COMPLETED` plus `completedAt`), read via one additional query scoped to the student's own entitled enrollment and mapped in memory by lesson ID (no N+1, no row ever created merely to serve a read — a missing `LessonProgress` row reads as `NOT_STARTED`). Added `POST /student/courses/:courseId/lessons/:lessonId/complete` to mark a currently-accessible, non-quiz (VIDEO/DOCUMENT) lesson completed, reusing the exact same entitlement chain and the same published-section/published-lesson/availability-window rules the read side applies, so a lesson that would not appear in the student's course structure cannot be completed either. Completion is idempotent and race-safe: it attempts to create a fresh `COMPLETED` row first, and on the unique-constraint conflict (`(studentUserId, lessonId, enrollmentId)`) falls back to an atomic `updateMany` guarded by `status: { not: COMPLETED }`, so a stale NOT_STARTED/STARTED row transitions once, an already-COMPLETED row is returned unchanged without re-stamping `completedAt`, and concurrent duplicate requests converge to exactly one row. A QUIZ lesson cannot be manually completed (new `QuizLessonCompletionNotAllowedError`, 400); every other rejection (foreign/unavailable/DRAFT/ARCHIVED lesson, lesson in an unentitled or different course) reuses the existing `LessonNotFoundError`/`CourseNotFoundError`, so no new "not found" taxonomy was introduced. `studentUserId` and `enrollmentId` are never accepted from the client — both are always derived from the same server-side entitlement proof. No schema/migration change was needed; the existing `LessonProgress` model and its composite FKs to `Lesson`/`Enrollment` already supported this fully.
- Implemented Instructor Quiz Authoring on the existing instructor tenant-authorization boundary: tenant-scoped `Quiz` create/list/detail/safe-metadata-update, `Question` create/update-metadata/reorder (reusing the Course module's reviewed `assertExactChildIdSet` reorder-validation utility and the same safe two-phase active-position resequence Section/Lesson reorder established), and `QuestionOption` create/update/reorder with a transaction-scoped `pg_advisory_xact_lock` (mirroring `StudentDeviceService.lockStudentDeviceState`) serializing the "at most one correct option per question" / "TRUE_FALSE has at most two options" invariants against concurrent authoring. This was the prior commit's work (`891d986`); it was not yet reflected in this file before this task, so it is recorded here for an accurate running history. Every nested resource proves ownership through an explicit `(id, tenantId, quizId/questionId)` `findFirst` rather than a bare-ID lookup trusting a client-supplied parent, the same discipline established for Course Section/Lesson. `QuestionOptionSummary.isCorrect` is authoring-only correct-answer configuration, deliberately never reused by any student-facing response type.
- Implemented Quiz Milestone Slice B (student-safe Quiz content delivery) on top of the Slice C entitlement boundary: `StudentCourseAccessService` gained one new method, `assertAccessibleQuizLesson(principal, courseId, lessonId)`, a thin extension of the existing `assertStudentCourseAccess` chain (never a duplicated/parallel authorization path) that additionally proves the target Lesson is `PUBLISHED`, type `QUIZ`, under a `PUBLISHED` Section, within its availability window, has a linked `QuizLesson`, and that the linked `Quiz` is itself in the student-visible `PUBLISHED` state (an authoring-in-progress `DRAFT` or retired `ARCHIVED` Quiz behind an otherwise-reachable Lesson is treated exactly like an unavailable lesson and never served). The returned `(tenantId, quizId)` pair is trusted because `QuizLesson.quiz` is reached through the schema's own `(quizId, tenantId) -> Quiz(id, tenantId)` composite foreign key, so a resolved `quizId` is already proven same-tenant with no separate check possible to bypass. A new `StudentQuizService` (in the Quizzes module, which now imports `CoursesModule` one-directionally — `CoursesModule` does not import `QuizzesModule`, so no circular dependency) calls that proof and maps the result through a brand-new, completely separate response-type family (`StudentQuizContent`/`StudentQuestion`/`StudentQuestionOption` in `quizzes/types/student-quiz.types.ts`) that never reuses the instructor-authoring `QuizSummary`/`QuestionSummary`/`QuestionOptionSummary` types — in particular `QuestionOptionSummary.isCorrect` is never referenced. Questions are filtered to `ACTIVE` (the schema's only student-visible question state) and, together with their options (which have no status/lifecycle field at all in the schema), are ordered by persisted `position` with `id` as an explicit deterministic tie-break. `GET /student/courses/:courseId/lessons/:lessonId/quiz` (guarded by the same `AccessTokenGuard`/`StudentDeviceGuard` chain as the rest of the student course surface) is structurally bound to the Course/Lesson path — there is no bare `/student/quizzes/:quizId` route, so a Quiz can only ever be reached through the exact authorized QUIZ Lesson that references it. Every rejection (foreign/cross-tenant Lesson substitution, wrong Lesson type, unavailable Lesson, unpublished Quiz, or unentitled Course) collapses to the existing `LessonNotFoundError`/`CourseNotFoundError` taxonomy — no new "not found" error codes were introduced, and no existence is leaked between "does not exist" and "not currently available to you." This endpoint is a pure content-delivery read: it creates no `QuizAttempt`, writes no `LessonProgress`, and consumes no attempt count; QuizAttempt creation, answer submission, scoring, attempt snapshots, and result/review screens remain explicitly out of scope for a later slice.
- Implemented Quiz Milestone Slice C (student Quiz attempt creation, answer submission, and server-side scoring) on top of Slice B's entitlement chain, with no schema/migration change — see `docs/QUIZ-ATTEMPTS.md` for the full design. `StudentCourseAccessService.assertAccessibleQuizLesson` was minimally extended to also return `enrollmentId` (needed for `QuizAttempt.enrollmentId`), reusing rather than duplicating the canonical chain. Routes are nested under the Slice B Quiz path (`POST/GET/PUT/POST` under `/student/courses/:courseId/lessons/:lessonId/quiz/attempts`) via a new `StudentQuizAttemptController`/`StudentQuizAttemptService` in the Quizzes module. Starting an attempt atomically creates the `QuizAttempt` row and one `QuizAttemptAnswer` row per currently-`ACTIVE` Question (never `ARCHIVED`), each frozen with `questionSnapshot`/`optionsSnapshot`/`correctAnswerSnapshot`/`pointsPossible` read fresh from live authoring state at that instant only — proven by a dedicated PostgreSQL test that edits a live Question's prompt, an Option's text, and which Option is marked correct, then shows the already-started attempt's snapshot and its eventual score are completely unaffected. Answer writes (`PUT .../answers/:questionId`) and final submission (`POST .../submit`) are serialized against each other by a shared transaction-scoped `pg_advisory_xact_lock` keyed to the attempt ID (mirroring `StudentDeviceService.lockStudentDeviceState`), so the two can never interleave; answer writes are idempotent by construction (always `update`, never `insert`, against the one pre-existing row per question) and validate membership only against that attempt's own frozen snapshot — a `questionId` never proves ownership until the transaction locates a matching `QuizAttemptAnswer` row, so a foreign/archived Question or an Option belonging to a different Question is rejected the same way regardless of whether it exists live. Submission is one atomic transaction that reloads current state under the lock, short-circuits to the stable persisted result if already `GRADED` (never rescoring, never re-stamping `submittedAt`/`gradedAt`), otherwise scores strictly from the frozen snapshot rows using `Prisma.Decimal` arithmetic throughout (no floating-point score/percentage math): an unanswered question or a selection not exactly matching `correctAnswerSnapshot.correctOptionIds` awards zero points (no partial credit), a match awards the full frozen `pointsPossible`; `passed` is computed exclusively from `QuizAttempt.passingScorePercentSnapshot` (see below) and the resulting boolean is persisted immediately, so a later instructor change to the live threshold cannot alter an already-started attempt's result in either direction. A client-supplied body on submit is structurally impossible to use for tampering — the handler binds no `@Body()` parameter at all — proven by a test that sends a fabricated score/pass payload and asserts the persisted result only ever reflects server-side computation. `attemptNumber` assignment is serialized by a second, differently-scoped advisory lock keyed to `(studentUserId, quizId)` so concurrent start requests cannot collide on the `(quizId, studentUserId, attemptNumber)` unique constraint. Every response uses a new, separate type family (`StudentQuizAttemptDetail`/`StudentQuizAttemptQuestion`/`StudentQuizAttemptOption`/`StudentQuizAttemptResult`) that never reuses instructor authoring types or Slice B's pre-attempt types; the "safe" Prisma `select` used by every read/write path never even loads `correctAnswerSnapshot`/`pointsAwarded`/`pointsPossible` into memory (a separate, narrower scoring-only query inside `submitAttempt` is the sole place that does), so a mapping bug cannot leak answer-key or per-question scoring data even in principle. Per this slice's conservative, explicitly-documented reveal-policy decision (`revealAnswersPolicy`'s exact semantics are not defined anywhere in this repository's docs), no per-question correctness or correct-Option data is ever exposed by this API, before or after submission — only the aggregate `result` (`scorePoints`/`maxPoints`/`percentage`/`passed`/`gradedAt`) is revealed once `GRADED`, and `percentage` is derived at read time from the persisted `scorePoints`/`maxPoints` rather than stored, so it can never drift from the values it is computed from. Ownership on every read/write is proven by `(tenantId, quizId, lessonId, studentUserId, attemptId)` all server-derived, never client-supplied; a foreign/random Attempt ID and another student's real Attempt both collapse to the same `QuizAttemptNotFoundError`, matching this codebase's established IDOR-avoidance convention. Starting, answering, and submitting an attempt create/modify no `LessonProgress` row — quiz-derived progress remains explicitly out of scope for a future slice.
- Implemented the `attemptLimit` V1 product rule (a subsequent focused fix to Slice C): the maximum number of attempts *successfully started* by a student for a Quiz **within the current Enrollment**, scoped by `(studentUserId, enrollmentId, quizId)`, counting every attempt regardless of status (`IN_PROGRESS`/`GRADED`/a future `ABANDONED`) so abandoning an attempt can never restore allowance; `null` means unlimited, matching the schema's own nullability, with no invented sentinel. Enforced inside `startAttempt`'s existing `(studentUserId, quizId)` advisory-lock transaction — no new lock scope — via a count-then-create sequence that raises a new narrow `QuizAttemptLimitReachedError` (`QUIZ_ATTEMPT_LIMIT_REACHED`, 409, never a raw Prisma failure) rather than creating the attempt. Proven race-safe directly against persisted database state: two concurrent start requests with exactly one slot remaining converge to exactly one created attempt and one clean 409, and the final attempt count for a limited Quiz/Enrollment never exceeds the configured limit.
- Fixed the passing-threshold historical-integrity gap previously surfaced and reported during Slice C review (`submitAttempt` had read `Quiz.passingScorePercent` live at grading time rather than from a value frozen when the attempt started, so an instructor changing that threshold while a student's attempt was still `IN_PROGRESS` would change what that attempt was graded against). The approved additive migration `20260830000000_add_quiz_attempt_passing_threshold_snapshot` adds exactly one nullable column, `QuizAttempt.passingScorePercentSnapshot Decimal? @db.Decimal(5, 2)` (mirroring `Quiz.passingScorePercent`'s datatype/nullability exactly) — the generated SQL is a single `ALTER TABLE quiz_attempts ADD COLUMN passing_score_percent_snapshot DECIMAL(5,2)`, additive-only, no other column/table touched. `startAttempt` now reads the live `Quiz.passingScorePercent` once, inside its existing atomic transaction, and freezes it into this column alongside the existing per-question snapshot writes; `null` stays `null` if the Quiz has no threshold configured, never later backfilled from live state. `submitAttempt` now computes `passed` exclusively from `QuizAttempt.passingScorePercentSnapshot`, never the live `Quiz` row. A hypothetical pre-migration row with a `null` snapshot collapses into the same already-defined "no threshold to evaluate against" `passed = null` semantics as a Quiz with no threshold configured — a deliberate, fail-safe choice requiring no migration-era branching, documented in `docs/QUIZ-ATTEMPTS.md`. Proven with four new PostgreSQL tests: threshold captured at start; an existing attempt graded against its frozen threshold survives the instructor raising the live threshold (and a brand-new attempt started afterward correctly captures the raised value); an existing attempt survives the instructor lowering the live threshold (cannot newly pass); and a client-supplied body on start cannot influence the captured snapshot (the start handler binds no `@Body()` parameter). Every other Slice C integrity property (Question/Option/correct-answer snapshot immutability, answer-vs-submit serialization, submit idempotency, no answer-key leakage, no `LessonProgress` writes, no client score/pass manipulation, `attemptLimit` enforcement/concurrency) was re-verified unchanged.
- Implemented Quiz Milestone Slice D (Quiz completion → `LessonProgress` integration), with no schema/migration change. The authoritative V1 rule — confirmed as a product decision after an initial correct STOP when the repository's own docs did not define it — is: a `GRADED` attempt completes its Quiz Lesson when `passingScorePercentSnapshot === null` (an ungraded/practice Quiz — any successful grading qualifies, since `passed` is legitimately `null`) or when a configured-threshold attempt has `passed === true`; a failed threshold-based attempt never creates or downgrades progress. This uses only the attempt's own already-persisted, already-frozen result fields — never a second pass/fail recalculation, and never live `Quiz` state. The check and, when it qualifies, the `LessonProgress` transition both run inside `submitAttempt`'s existing single transaction (the same one that grades and finalizes the attempt), so there is never a committed state where one succeeded without the other; no new transaction boundary or lock scope was introduced. This is the *only* authoritative path to Quiz Lesson completion — `POST /student/courses/:courseId/lessons/:lessonId/complete` continues to reject `QUIZ` lessons exactly as before. `StudentCourseAccessService.upsertCompletedProgress` (previously a private, `completeLesson`-only helper) was generalized to accept an optional Prisma client/transaction parameter (`client: PrismaService['client'] | PrismaTransactionClient = this.prismaService.client`, the same convention `TenantAuthorizationService` already established), so `submitAttempt` can pass its own `tx` and reuse this one canonical progress-upsert implementation rather than duplicating it. That reuse surfaced a genuine bug during validation: the method's original implementation (an `insert`, catching the expected unique-constraint violation, then falling back to a guarded `updateMany`) is safe as an independent top-level statement (as `completeLesson` always calls it) but is **not** safe inside an already-open, multi-statement transaction — a caught application-level exception does not roll PostgreSQL back to a safe point, so the entire surrounding transaction (including the attempt-grading writes already made) is left aborted, and every subsequent statement in it fails too. The fix replaces the implementation with one native PostgreSQL `INSERT ... ON CONFLICT ("student_user_id", "lesson_id", "enrollment_id") DO UPDATE ... WHERE status <> 'COMPLETED'` statement, which handles the create/update/already-completed-no-op cases entirely inside PostgreSQL for a single statement and never raises an application-level exception for the conflict case — safe in both calling contexts with no special-casing, and correctly handles the genuinely-reachable cross-attempt race (two different `QuizAttempt`s for the same Lesson, each in its own transaction behind its own per-attempt advisory lock, submitted concurrently) with no additional/global lock. The full existing Course Slice D PostgreSQL suite (manual VIDEO/DOCUMENT completion, idempotency, concurrent-duplicate-completion) was re-run and passed unchanged, confirming the refactor preserves `completeLesson`'s externally-observable behavior exactly. Ownership (`studentUserId`/`lessonId`/`enrollmentId`) is entirely server-derived from the same `assertAccessibleQuizLesson` proof `submitAttempt` already required, never client-supplied.
- Implemented Media Slice A: provider-independent instructor tenant-scoped list and detail routes for legitimately persisted `VideoAsset` and `DocumentAsset` records. The API never moves large media bytes through NestJS, exposes no permanent media URLs, does not manufacture placeholder provider/storage references, and keeps provider upload authorization/playback/download authorization deferred.
- Implemented Media Slice B (protected student Document Lesson access boundary), with no schema/migration change — see `docs/MEDIA.md` for the full design. `StudentCourseAccessService` gained one new method, `assertAccessibleDocumentLesson(principal, courseId, lessonId)`, a thin extension of the existing `assertStudentCourseAccess` chain (never a duplicated/parallel authorization path) that additionally proves the target Lesson is `PUBLISHED`, type `DOCUMENT`, under a `PUBLISHED` Section, within its availability window, has a linked `DocumentLesson`, and that the linked `DocumentAsset` is itself `READY` — a document referenced by a Lesson while still `UPLOADING`/`PROCESSING`, or that ended up `FAILED`/`ARCHIVED`, is treated exactly like an unavailable Lesson and never granted runtime access, clarifying Media Slice A's own noted warning that authoring-time asset attachment is a looser, distinct check from student runtime access. The returned `(tenantId, documentAssetId)` pair is trusted because `DocumentLesson.documentAsset` is reached through the schema's own `(documentAssetId, tenantId) -> DocumentAsset(id, tenantId)` composite foreign key — the same tenant-match guarantee `assertAccessibleQuizLesson` already relies on for `Quiz`, and directly proven unbypassable by a new PostgreSQL test that attempts (and fails, on the FK constraint) to attach a cross-tenant `DocumentAsset` to a `DocumentLesson` via direct Prisma writes. A new `StudentDocumentAccessService` (in the Media module, which now imports `CoursesModule` and `DeviceModule` one-directionally, mirroring exactly how `QuizzesModule` already imports both — `CoursesModule` imports neither, so no circular dependency) calls that proof and returns a brand-new response type, `StudentDocumentAccessStatus`, that deliberately excludes `documentAssetId`, `externalAssetRef`, `providerKey`, `processingStatus`, and every other instructor-authoring/provider-internal field — carrying only `lessonId`, `fileName`, `mimeType`, `fileSizeBytes`, `ready: true`, and `authorizedAt`. `GET /student/courses/:courseId/lessons/:lessonId/document/access` (guarded by the same `AccessTokenGuard`/`StudentDeviceGuard` chain as the rest of the student course surface) is structurally bound to the Course/Lesson path — there is no bare `/student/documents/:documentAssetId` route, so a document can only ever be reached through the exact authorized DOCUMENT Lesson that references it, and the client never supplies `tenantId`, `studentUserId`, `enrollmentId`, or `documentAssetId`. GET, not POST, because no provider has been selected and this slice deliberately does not fabricate a signed URL, download token, or any other ephemeral access capability — this is a pure, side-effect-free authorization read, proven by a dedicated test that calls the endpoint twice and confirms zero `LessonProgress`/`QuizAttempt` rows and an unmutated `Enrollment` row result. No formal provider-port interface was introduced: with no provider selected and no second implementation to satisfy it, one would be a premature, speculative abstraction per `AGENTS.md`; the future provider-call insertion point is instead documented in code comments directly inside `StudentDocumentAccessService.getDocumentAccess` and in `docs/MEDIA.md`. Every rejection (foreign/cross-tenant Lesson substitution, another student's Enrollment, wrong Lesson type — VIDEO or QUIZ, unavailable Lesson, DRAFT/ARCHIVED Course, unpublished Section/Lesson, outside the availability window, non-`ACTIVE` TenantStudent, missing/non-`ACTIVE`/expired/not-yet-started Enrollment, or a non-`READY` DocumentAsset) collapses to the existing `LessonNotFoundError`/`CourseNotFoundError` taxonomy — no new "not found" error codes were introduced, matching the established convention from Course Slice C and Quiz Slice B/C.
- Implemented Media Slice C (protected student Video Lesson playback authorization boundary), with no schema/migration change — see `docs/MEDIA.md` for the full design. `StudentCourseAccessService` gained one new method, `assertAccessibleVideoLesson(principal, courseId, lessonId)`, mirroring `assertAccessibleDocumentLesson` exactly (itself mirroring `assertAccessibleQuizLesson`) — the target Lesson must be `PUBLISHED`, type `VIDEO`, under a `PUBLISHED` Section, within its availability window, have a linked `VideoLesson`, and the linked `VideoAsset` must be `READY`; `UPLOADING`/`PROCESSING`/`FAILED`/`ARCHIVED` are all denied exactly like an unavailable Lesson, and the returned `(tenantId, videoAssetId, durationSeconds)` tuple is trusted via the schema's `(videoAssetId, tenantId) -> VideoAsset(id, tenantId)` composite foreign key — directly proven unbypassable by a new PostgreSQL test attempting (and failing, on the FK constraint) to attach a cross-tenant `VideoAsset` to a `VideoLesson`. A new `StudentVideoAccessService` (in the Media module, which already imported `CoursesModule`/`DeviceModule` one-directionally for Slice B) calls that proof and returns a brand-new response type, `StudentVideoAccessStatus`, carrying only `lessonId`, `ready: true`, `durationSeconds`, and `authorizedAt` — deliberately excluding `videoAssetId` (no concrete client need for it yet), `externalAssetRef`, `providerKey`, `processingStatus`, and any playback URL/token/DRM-license material. `GET /student/courses/:courseId/lessons/:lessonId/video/access` (same `AccessTokenGuard`/`StudentDeviceGuard` chain) is structurally bound to the Course/Lesson path — no bare `/student/videos/:videoAssetId` route exists, and the client never supplies `tenantId`/`studentUserId`/`enrollmentId`/`videoAssetId`. As with Slice B, GET rather than POST, and no formal provider-port interface was introduced (same `AGENTS.md` speculative-abstraction rationale); the future provider-call insertion point is documented in `StudentVideoAccessService.getVideoAccess` and in `docs/MEDIA.md`. This is a pure, side-effect-free authorization read — proven by a dedicated test that calls the endpoint twice and confirms zero `LessonProgress`/`QuizAttempt` rows and an unmutated `Enrollment` row — and a second dedicated test proves the pre-existing generic manual VIDEO-lesson completion endpoint (`POST .../complete`, Course Slice D) is completely unaffected: playback authorization alone never completes the Lesson, and the manual-completion endpoint still works exactly as before, independent of this slice. Every rejection (foreign/cross-tenant Lesson substitution, another student's Enrollment, wrong Lesson type — DOCUMENT or QUIZ, unavailable Lesson, DRAFT/ARCHIVED Course, unpublished Section/Lesson, outside the availability window, non-`ACTIVE` TenantStudent, missing/non-`ACTIVE`/expired/not-yet-started Enrollment, or a non-`READY` VideoAsset) collapses to the existing `LessonNotFoundError`/`CourseNotFoundError` taxonomy — no new "not found" error codes were introduced. Media Slice A's instructor `VideoAsset` routes/response fields are unchanged; no VideoAsset create/update endpoint was added.
- Implemented Media Slice G (protected Bunny video playback capability issuance) on the existing
  Media Slice C authorization boundary, with no schema/migration change.
  `StudentCourseAccessService.assertAccessibleVideoLesson` was minimally extended to also return the
  proven READY asset's own `providerKey`/`externalAssetRef` (never re-queried or client-supplied).
  `VideoProvider` gained one new method, `createPlaybackCapability`, implemented in
  `BunnyStreamVideoProvider` using Bunny's CDN Pull Zone "directory" (path-style) token
  authentication — deliberately not the separate embed/iframe view-token formula, which does not
  protect the underlying HLS files. The signed URL is directory-scoped to the video's own
  `/{videoId}/` storage prefix (`token_path=/{videoId}/`, `HS256-` HMAC-SHA256 digest, independently
  verified byte-for-byte against Bunny's own official reference implementation and published test
  vectors before implementation), embedding the token as a path segment
  (`/bcdn_token=...&expires=.../{videoId}/playlist.m3u8`) rather than a query string, so a native HLS
  player (`AVPlayer`/`ExoPlayer`/`expo-video`) resolves every segment/quality request through the same
  authorized prefix automatically — the documented pattern that avoids the query-string-token
  limitation on native players. TTL is computed per-request from the specific video's own
  `durationSeconds` (`clamp(duration + 900s, 300s, 14400s)`, with a bounded 7200s fallback when
  duration is unknown) rather than one flat constant, because Bunny's `expires` is a single
  wall-clock deadline checked on every request, not a sliding per-segment window — a flat short TTL
  would 403 mid-playback for any lecture longer than it. IP binding is deliberately disabled for V1
  (MENA mobile network reliability). Two new safety checks reject rather than sign unsafely: a
  service-level check that the asset's persisted `providerKey` matches the configured Bunny library
  (`VideoAssetProviderInvariantViolationError`), and a provider-level check that `externalAssetRef` is
  a well-formed Bunny GUID (`VideoPlaybackSigningFailedError`); both are `502`, leave `VideoAsset`
  state untouched, and are proven by dedicated tests. The student response now carries
  `lessonId`/`durationSeconds`/`playbackUrl`/`expiresAt` only — `videoAssetId`, `tenantId`,
  `providerKey`, `externalAssetRef`, and all Bunny credentials remain excluded, and the signed URL is
  never logged or persisted. Playback issuance remains a pure, side-effect-free, repeatable capability
  action: no `LessonProgress`/`QuizAttempt`/`Enrollment`/`SecurityEvent` write, no playback-session
  row, no DRM. See `docs/MEDIA.md` for the full design, including why manifest-only protection was
  rejected and the exact IP-binding/TTL reasoning.
- Preserved the existing Git repository and root pnpm lockfile model.

## Current Architecture Baseline

- Monorepo using pnpm workspaces.
- Apps: `apps/mobile`, `apps/web`, and `apps/api`.
- Current stack: Expo SDK 57 + React Native + Expo Router + TypeScript, Next.js 16 + TypeScript, NestJS 11 + TypeScript.
- Planned data layer is PostgreSQL + Prisma. Prisma schema and the first reviewed migration SQL artifact are implemented and have been validated against disposable PostgreSQL 16.
- The API has a Nest-managed Prisma 7 runtime boundary using the official PostgreSQL adapter and one `pg` pool per API process.
- Backend domain/database design covers canonical users, tenant memberships, enrollments, devices, content, quizzes, progress, notifications, security events, deletion lifecycle, UUIDv7-compatible IDs, and concurrency-sensitive operations.
- V1 roles: `STUDENT`, `INSTRUCTOR`, `PLATFORM_ADMIN`.
- V1 authentication design uses email/password, Argon2id password hashes, 10-minute HS256 JWT access tokens, opaque rotating refresh sessions, managed account creation, and purpose-specific activation/reset tokens.
- Auth one-time token persistence stores only lowercase 64-character SHA-256 hex token hashes; raw activation/reset tokens must never be persisted.
- Internal auth primitives use `argon2`, `@nestjs/jwt`, Node `crypto`, and application-generated UUIDv7 IDs. Refresh rotation is transaction-safe and requires both refresh session ID and opaque token.
- Internal auth orchestration composes the primitives for identity/session use cases. Web refresh sessions default to 10 hours; mobile refresh sessions default to 30 days.
- Public auth HTTP transport exposes `/auth/*` routes. Web refresh tokens are cookie-only, mobile refresh tokens use explicit body transport, and protected auth routes use Bearer access tokens.
- Multi-tenant SaaS from the beginning.
- Tenant operators are represented by `TenantMembership`. Students use the separate `TenantStudent` association and must not be modeled as tenant staff membership.
- Tenant/instructor/student/enrollment HTTP routes now enforce current database role/status and tenant membership checks. Instructor course metadata routes use the same DB-fresh instructor tenant authorization boundary. Instructor course section and lesson routes reuse that same boundary and additionally prove nested Section/Lesson ownership through Prisma composite keys inherited from the already-authorized Course/Section, rather than trusting a client-supplied parent ID. Student enrollment reads and the new student course reads both compose Bearer authentication with `StudentDeviceGuard`; student course reads additionally require the new course-content entitlement chain (DB-fresh ACTIVE STUDENT, ACTIVE TenantStudent, currently entitled ACTIVE Enrollment, `PUBLISHED` Course in an ACTIVE tenant) before any course/section/lesson data is returned.
- Instructor Quiz Authoring routes (`/instructor/tenants/:tenantId/quizzes/**`) use the same DB-fresh instructor tenant-authorization boundary as Course authoring, with the same nested-ownership-via-composite-lookup discipline. Student Quiz delivery (`GET /student/courses/:courseId/lessons/:lessonId/quiz`) and student Quiz Attempts (`/student/courses/:courseId/lessons/:lessonId/quiz/attempts/**`) both reuse the exact same `StudentCourseAccessService` entitlement chain as student Course reads, via `assertAccessibleQuizLesson` for QUIZ-Lesson-specific linkage/lifecycle proof — a thin extension of the one canonical chain, never a duplicated authorization path inside the Quizzes module. `QuizzesModule` now imports `CoursesModule` one-directionally (for `StudentCourseAccessService` only) and `DeviceModule` (for `StudentDeviceGuard`); `CoursesModule` imports neither `QuizzesModule` nor anything that would create a cycle. Two independently-scoped transaction-scoped PostgreSQL advisory locks serialize the Quiz Attempt write surface: one per `(studentUserId, quizId)` for attempt-start `attemptNumber` assignment, one per `attemptId` for answer-write-vs-submission serialization — both namespaced distinctly from each other and from `StudentDeviceService.lockStudentDeviceState`'s per-student lock and `QuestionOptionService`'s per-question lock.
- Student Document Lesson access (`GET /student/courses/:courseId/lessons/:lessonId/document/access`) reuses the same `StudentCourseAccessService` entitlement chain via `assertAccessibleDocumentLesson` (mirroring `assertAccessibleQuizLesson`'s pattern), additionally requiring the linked `DocumentAsset.processingStatus` to be `READY`. `MediaModule` imports `CoursesModule` and `DeviceModule` one-directionally, mirroring `QuizzesModule`'s existing import shape; `CoursesModule` imports neither. Now that Documents are locked to Cloudflare R2, this endpoint issues a short-lived presigned R2 GET for the finalized object key already stored in `DocumentAsset.externalAssetRef`, while rejecting any READY asset whose key still points at `document-uploads`.
- Student Video Lesson playback authorization (`GET /student/courses/:courseId/lessons/:lessonId/video/access`) reuses the exact same `StudentCourseAccessService` entitlement chain via `assertAccessibleVideoLesson`, mirroring `assertAccessibleDocumentLesson`'s pattern, additionally requiring the linked `VideoAsset.processingStatus` to be `READY`. It is registered in the already-existing `MediaModule`. As of Media Slice G it issues a real, short-lived, path-scoped Bunny CDN directory-token HLS playback URL (`BunnyStreamVideoProvider.createPlaybackCapability`) rather than metadata only — see `docs/MEDIA.md` for the full construction, TTL, and IP-binding reasoning. DRM remains unimplemented.
- Student device authorization defaults to one approved active device, with configurable architecture. Device authorization uses an app-generated installation UUID supplied by the native client, stores only a hash, and checks current database state through `StudentDeviceGuard`.
- Student device-change approvals belong to `PLATFORM_ADMIN`, not instructors.
- Arabic/English and RTL/LTR support are first-class requirements.
- No in-app payments in V1.

## Current Toolchain

- Node.js 22.23.2.
- pnpm 10.34.5 pinned through `packageManager`.
- pnpm workspaces.
- Turborepo is not used.
- Windows development environment validated.

## Current Framework Versions

- API: NestJS 11.2.1.
- ORM/runtime tooling: Prisma 7.9.1, `@prisma/client` 7.9.1, `@prisma/adapter-pg` 7.9.1, and `pg` 8.23.0.
- Web: Next.js 16.3.2, React 19.2.8, Tailwind CSS 4.3.3.
- Mobile: Expo 57.0.15, Expo Router 57.0.15, React Native 0.86.2, React 19.2.3.

## Known Issues / Warnings

- Course/content product functionality does not exist yet.
- No seed data, product modules, or product repositories exist yet.
- Media Slice A exists for instructor-side VideoAsset/DocumentAsset tenant-scoped reads. Media Slice B exists for the student-side DOCUMENT Lesson runtime authorization boundary (`GET /student/courses/:courseId/lessons/:lessonId/document/access`) and issues an ephemeral R2 download capability for the finalized READY object after that boundary succeeds. Media Slice C exists for the equivalent student-side VIDEO Lesson runtime authorization boundary (`GET /student/courses/:courseId/lessons/:lessonId/video/access`); as of Media Slice G it also issues a real, short-lived, path-scoped Bunny CDN HLS playback capability (`playbackUrl`/`expiresAt`) once entitlement and READY-state video readiness are proven. R2 document upload/download capability issuance and Bunny video upload/playback capability issuance exist; DRM, piracy prevention, abandoned-upload cleanup, and provider-object cleanup remain deferred.
- Course authoring Slice A (core course metadata), Slice B (Section/Lesson create, metadata update, archive, and whole-list reorder), Slice C (student course authorization/read), and Slice D (minimal lesson progress) exist. Lesson creation for VIDEO/DOCUMENT/QUIZ types requires the instructor to reference an already-existing tenant-scoped VideoAsset/DocumentAsset/Quiz row by ID; Quiz authoring exists and DocumentAsset upload exists, but VideoAsset upload still has no flow. A currently-unavailable lesson (before `availableFrom` or at/after `availableUntil`) is omitted entirely from the student structure response rather than returned as locked metadata — the conservative choice since neither `docs/PRODUCT.md` nor `docs/BACKEND-DOMAIN.md` specify this, and omission leaks no title/type/existence about content the student cannot yet reach. Lesson progress is currently limited to a tri-state status (NOT_STARTED/STARTED/COMPLETED), with manual completion for non-quiz lessons and automatic completion for QUIZ lessons on a qualifying Quiz Attempt (Quiz Milestone Slice D — see below) — video watch-time/resume-position writes and persisted aggregate course percentages are deliberately not implemented. Course lifecycle transitions, real video streaming, and frontend/mobile course UI remain pending.
- Instructor Quiz Authoring (Quiz/Question/QuestionOption create/read/update/reorder), Quiz Milestone Slice B (student-safe Quiz content delivery, `GET /student/courses/:courseId/lessons/:lessonId/quiz`), Quiz Milestone Slice C (student Quiz attempt start/read/answer/submit with server-side scoring, `attemptLimit` enforcement, and an immutable per-attempt passing-threshold snapshot), and Quiz Milestone Slice D (Quiz completion → `LessonProgress` integration, per the V1 rule documented in `docs/QUIZ-ATTEMPTS.md`) exist. A QUIZ Lesson can now be completed exactly one way — a qualifying `GRADED` attempt — and the generic manual-completion endpoint continues to reject QUIZ lessons. Attempt result/review UI, aggregate Course completion percentages, and `clientSubmissionKey`-based idempotent attempt start (an optional schema field for deduplicating mobile retry-created attempts; not required by any specified request shape, and submission is already fully idempotent via attempt-status short-circuiting) remain pending/deferred.
- Authentication/session behavior and V1 onboarding decisions are designed; internal primitives, orchestration services, public auth HTTP transport, and student device authorization foundation exist.
- Authentication one-time token persistence, internal generation/hashing/consumption services, login orchestration, activation completion, refresh orchestration, logout, password change, password-reset completion, HTTP DTO validation, auth route throttling, Bearer guard, web refresh cookies, trusted-origin checks, device authorization routes, and Platform Admin device-change review routes exist. Delivery, mobile storage, tenant authorization, course/content authorization, and distributed rate limiting are not implemented.
- Platform Admin instructor onboarding, instructor tenant/student/enrollment APIs, instructor course metadata APIs, instructor course section/lesson authoring APIs, instructor quiz authoring APIs, student course authorization/read APIs, student lesson-progress read/completion APIs, student quiz content-delivery APIs, and student quiz attempt APIs (including `attemptLimit` enforcement and quiz-derived `LessonProgress` completion) exist. Activation delivery, student removal endpoints, course lifecycle transitions, protected content delivery (video/document), video watch-time/resume tracking, and distributed rate limiting are not implemented.
- Runtime API startup requires a valid `DATABASE_URL`; build/typecheck/unit tests do not require a live database.
- Prisma v7 generated client output uses the explicit path `apps/api/.generated/prisma`, which is intentionally ignored. API build emits a compiled generated client under ignored build output.
- PostgreSQL-only constraints are tracked in `docs/DATABASE-CONSTRAINTS.md`; partial unique indexes and stable check constraints are represented in the initial migration SQL, while lesson detail integrity and JSON payload limits remain application-controlled.
- No CI/CD exists yet.
- pnpm dependency installation may need `--config.offline=false` on machines with a global pnpm `offline=true` setting.
- Next.js build may require normal process-spawn permissions on Windows because it uses worker processes.
- No iOS Simulator or physical-device validation was performed on Windows.

## Pending Decisions

- Provider selection is locked for V1 media: Documents = Cloudflare R2; Videos = Bunny Stream
  Standard Network. Upload and playback capability issuance are both implemented; remaining media
  decisions are future DRM integration (Bunny MediaCage) and cleanup/operational policy, not
  provider reselection.
- Video/security provider selection after dedicated technical and cost evaluation.
- Final visual branding, fonts, colors, and logo.
- Final production auth hardening/tuning after implementation benchmarks and UX review.
- Final legal/privacy retention policy for account deletion and security events.
- App Store bundle identifiers and Android application IDs.
- EAS build profiles and production build identity.
- Deployment target and production infrastructure.

## Intentionally Deferred Work

- Product domain feature implementation beyond the approved auth, device, tenancy/enrollment, and course metadata foundations.
- Course lifecycle, section, lesson, content, playback, and student course APIs.
- Course entitlement authorization for protected course content.
- Activation/reset delivery flows and password reset request flow.
- Distributed rate limiting.
- Cleanup jobs for expired/consumed activation/reset tokens.
- Applying migrations to any persistent/shared database, seed data, and product database access logic.
- Docker and infrastructure.
- CI/CD.
- Payments/billing implementation.
- Video provider integration.
- Security feature implementation.
- Final UI design/branding.
- Shared packages.

## Last Validation Results

Scaffolding task validation passed:

- `node --version` -> `v22.23.2`.
- `corepack pnpm --version` -> `10.34.5`.
- `pnpm install --frozen-lockfile --config.confirm-modules-purge=false --config.offline=false` passed.
- API lint, typecheck, test, build, and startup smoke test passed.
- Web lint, typecheck, production build, and startup smoke test passed.
- Mobile lint, typecheck, Expo config validation, `expo install --check`, and Expo Doctor passed.
- `git diff --check` passed.

Backend design task validation passed:

- Read `AGENTS.md` and relevant `docs/` files before editing.
- Inspected `apps/api` scaffold and confirmed no product modules exist.
- Added documentation only; no app source code or dependencies changed.
- Markdown/source text scans passed for forbidden implementation artifacts and scope contradictions.
- `git diff --check` passed.

Prisma schema task validation passed:

- `corepack pnpm install --config.offline=false` passed.
- `corepack pnpm --filter @edvora/api prisma:format` passed.
- `corepack pnpm --filter @edvora/api prisma:validate` passed.
- `corepack pnpm --filter @edvora/api prisma:generate` passed and generated ignored local output only.
- API lint, typecheck, test, and build passed.
- Root `corepack pnpm check` passed.
- `git diff --check` passed.
- Repository hygiene checks found no nested lockfiles, committed `.env` files, Prisma migrations, or unignored generated Prisma client output.

Initial migration artifact task validation passed:

- Confirmed repository started clean at `ef7bd3a feat(database): establish Prisma schema foundation`.
- Generated SQL with `corepack pnpm --filter @edvora/api exec prisma migrate diff --config prisma.config.ts --from-empty --to-schema prisma/schema.prisma --script --output prisma/migrations/20260823000000_initial_schema/migration.sql`.
- Manually reviewed migration SQL for enums, tables, primary keys, foreign keys, referential actions, indexes, UUID columns, `TIMESTAMPTZ(6)`, `JSONB`, decimal types, and tenant-scoped composite relations.
- Added PostgreSQL-only partial unique indexes and stable check constraints to the reviewed migration SQL.
- Prisma format, validate, and generate passed.
- API lint, typecheck, tests, and build passed.
- Root `corepack pnpm check` passed.
- `git diff --check` passed.
- No database was connected or modified.

Disposable PostgreSQL migration validation passed:

- Confirmed repository started clean at `5af56dc feat(database): add reviewed initial PostgreSQL migration`.
- Created an isolated disposable PostgreSQL 16 database for validation without touching unrelated Docker containers or cloud infrastructure.
- Applied `apps/api/prisma/migrations/20260823000000_initial_schema/migration.sql` successfully from an empty database.
- Verified expected tables, enums, primary keys, foreign keys, unique indexes, custom partial indexes, custom check constraints, UUID columns, `TIMESTAMPTZ`, and `JSONB` fields through PostgreSQL introspection.
- Tested active-device, pending-device-change, active-enrollment, representative check constraints, tenant composite foreign keys, security event nullable references, and quiz attempt JSONB snapshot behavior with synthetic data.
- Recreated the disposable database and reapplied the same migration successfully to confirm repeatability.
- Removed the disposable database container after validation.
- Root `corepack pnpm check` and `git diff --check` passed after documentation updates.

Prisma/PostgreSQL runtime foundation validation passed:

- Confirmed repository started clean at `d44f6f8 test(database): validate initial migration on PostgreSQL 16`.
- Verified Prisma 7 official PostgreSQL runtime guidance requires a driver adapter.
- Added `@prisma/adapter-pg`, `pg`, and `@types/pg`.
- Prisma format, validate, and generate passed.
- API lint, typecheck, unit tests, and build passed.
- Started the API successfully against a disposable PostgreSQL 16 container with the approved initial migration applied.
- Removed the disposable Edvora runtime-test container after validation; the unrelated `mini-inventory-system-db-1` container was not modified.
- Root `corepack pnpm check` and `git diff --check` passed.

Authentication/security design validation passed:

- Read `AGENTS.md`, relevant `docs/`, Prisma schema, and database runtime infrastructure.
- Created `docs/AUTHENTICATION.md`.
- Updated durable authentication decisions in `docs/DECISIONS.md`.
- Updated this status file.
- No dependencies, schema/migration changes, app source changes, `.env` files, or secrets were added.
- Root `corepack pnpm check` and `git diff --check` passed.

Authentication onboarding decision validation passed:

- Read `AGENTS.md`, `docs/AUTHENTICATION.md`, product/security/domain/database docs, decision/status docs, and Prisma schema.
- Added `docs/AUTH-SCHEMA-PLAN.md`.
- Updated account creation, activation, reset, token, password, device, and MFA decisions in `docs/AUTHENTICATION.md`.
- Updated durable decisions in `docs/DECISIONS.md`.
- Updated this status file.
- No dependencies, Prisma schema/migration changes, API source changes, web/mobile changes, `.env` files, or secrets were added.
- Root `corepack pnpm check` and `git diff --check` passed.

Auth token persistence validation passed:

- Added `AccountActivationToken`, `PasswordResetToken`, and `AccountActivationPurpose` to the Prisma schema.
- Generated additive migration `20260823010000_add_auth_security_tokens` without editing the approved initial migration.
- Added PostgreSQL CHECK constraints for auth-token timestamp ordering.
- Applied the initial migration and auth-token migration sequentially to an isolated disposable PostgreSQL 16 container.
- Verified auth-token tables, enum, indexes, foreign keys, CHECK constraints, and representative behavior with synthetic data.
- Confirmed duplicate token hashes fail, historical consumed tokens remain representable, nullable initiating actor works, and target user deletion cleans up short-lived token rows while initiating actor deletion sets references to null.
- Removed the disposable Edvora PostgreSQL container after validation; the unrelated `mini-inventory-system-db-1` container was not modified.
- Prisma format, validate, generate, API lint/typecheck/tests/build, root `corepack pnpm check`, and `git diff --check` passed.

Internal auth primitive validation passed:

- Added minimal dependencies: `argon2@0.45.1` and `@nestjs/jwt@11.0.2`.
- Added root pnpm build-script approval for `argon2` only.
- Implemented internal API auth module primitives without public controllers, guards, routes, Passport, frontend/mobile work, Redis, OAuth, MFA, or email delivery.
- Unit tests cover auth config, Argon2id password hashing/verification/policy/rehash detection, JWT signing/verification/error behavior, opaque token hashing, and UUIDv7 shape.
- Opt-in PostgreSQL integration test applies the initial and auth-token migrations to disposable PostgreSQL 16 and validates transactional refresh rotation/replay, revocation, account-status checks, activation-token issuance/consumption, and password-reset-token issuance/consumption.
- The default `pnpm test` and root `pnpm check` do not require Docker or a live database.
- The disposable Edvora PostgreSQL container was removed after validation; the unrelated `mini-inventory-system-db-1` container was not modified.
- Prisma format, validate, generate, API lint/typecheck/tests/build, opt-in auth PostgreSQL tests, root `corepack pnpm check`, and `git diff --check` passed.

Internal auth orchestration validation passed:

- Confirmed repository started clean at `46dafd4 feat(auth): establish authentication security primitives`.
- Implemented internal orchestration only; no controllers, public routes, guards, Passport strategies, cookies, device authorization, tenant authorization, web/mobile auth, email delivery, Redis, MFA, or OAuth were added.
- Added normalized email lookup and internal use-case services for login, account activation, refresh, logout, logout-all, password change, password-reset completion, and auth security-event persistence.
- Verified activation and reset completion are coordinated transactionally with credential/session changes.
- Verified password change revokes other sessions and rotates the surviving current session.
- Ran the opt-in auth PostgreSQL integration suite against disposable PostgreSQL 16.13 after applying the initial and auth-token migrations.
- Removed the disposable Edvora PostgreSQL container after validation; the unrelated `mini-inventory-system-db-1` container was not modified.
- Prisma format, validate, generate, API lint/typecheck/tests/build, opt-in auth PostgreSQL tests, root `corepack pnpm check`, and `git diff --check` passed.

Public auth HTTP boundary validation passed:

- Added public auth HTTP controllers/routes for login, refresh, logout, logout-all, activation completion, authenticated password change, and password-reset completion.
- Added DTO validation, stable auth HTTP error mapping, Bearer access-token guard, typed authenticated principal helper, web refresh cookies, trusted-origin checks, no-store token responses, credentialed CORS configuration, and in-process auth throttling.
- API Prisma format, validate, and generate passed.
- API lint, typecheck, default unit/controller tests, and build passed.
- Ran the opt-in PostgreSQL auth integration suite against disposable PostgreSQL 16.13 after applying the initial and auth-token migrations. The suite includes the real Nest HTTP boundary and validates mobile and web auth transport paths, refresh rotation/replay behavior, activation, password reset completion, logout, and the device-authorization non-implementation boundary.
- Root `corepack pnpm check` passed.
- `git diff --check` passed.
- The disposable Edvora PostgreSQL container was removed after validation. The unrelated `mini-inventory-system-db-1` database was not touched.

Student device authorization foundation validation passed:

- Prisma format, validate, and generate must pass.
- API lint, typecheck, tests, and build must pass.
- Existing auth PostgreSQL integration tests and new device authorization PostgreSQL/E2E tests must pass against disposable PostgreSQL 16.
- Root `corepack pnpm check` and `git diff --check` must pass.
- Prisma format, validate, and generate passed.
- API lint, typecheck, tests, and build passed.
- Existing auth PostgreSQL integration tests and new device authorization PostgreSQL/E2E tests passed against disposable PostgreSQL 16.
- Root `corepack pnpm check` and `git diff --check` passed.
- Disposable PostgreSQL validation used PostgreSQL 16.13 with the existing initial and auth-token migrations applied in order.
- Device tests covered login/device separation, first-device concurrency, same-installation idempotency, one pending request, Platform Admin-only review, approval replacement, rejection preservation, logout/password-reset independence, and immediate guard behavior after device replacement.
- The disposable Edvora PostgreSQL container was removed after validation. The unrelated `mini-inventory-system-db-1` database was not touched.

Tenant-student association design validation passed:

- Confirmed repository started clean at `61d9fed feat(devices): implement student device authorization`.
- Created `docs/TENANT-STUDENT-DESIGN.md`.
- Updated domain/database/decision/status documentation only.
- No Prisma schema, migration, dependency, API source, web/mobile, `.env`, or secret changes were made.
- Root `corepack pnpm check` and `git diff --check` passed.

Tenant-student persistence validation passed:

- Prisma schema includes `TenantStudentStatus`, `TenantStudent`, User/Tenant relations, and the enrollment composite relation.
- New additive migration `20260823020000_add_tenant_student_associations` adds `tenant_students`, the unique tenant/student association, referential integrity, enrollment composite FK, and stable timestamp CHECK constraints.
- PostgreSQL migration execution, structural inspection, constraint tests, duplicate association concurrency tests, existing auth/device regression tests, Prisma validation/generation, API lint/typecheck/tests/build, root `corepack pnpm check`, and `git diff --check` passed.

Tenancy/enrollment service foundation validation passed:

- Prisma format, validate, and generate passed.
- API lint, typecheck, unit tests, and build passed.
- Full opt-in PostgreSQL auth/device/tenancy-enrollment integration suites passed against fresh disposable PostgreSQL 16.
- Root `corepack pnpm check` and `git diff --check` passed.

Instructor Course Core Slice A validation passed:

- API lint, typecheck, relevant tests, and build passed.
- Course PostgreSQL HTTP tests passed against disposable PostgreSQL 16.
- `git diff --check` passed.

Instructor Course Sections/Lessons/Ordering Slice B validation passed:

- Confirmed repository started clean at `97a8c74 feat(courses): add instructor course core`.
- API lint, typecheck, unit tests (unchanged, 42 passed), and build passed.
- Course Slice A and Slice B PostgreSQL HTTP tests (14 tests) passed against a fresh disposable PostgreSQL 16 container with the three approved migrations applied in order; rerun three times to check for concurrency-test flakiness, all passed. The unrelated `mini-inventory-system-db-1` container was not touched; the disposable container was removed after validation.
- Fixed a pre-existing latent bug discovered while validating the position-conflict path: `isKnownUniqueViolation` (shared by the tenancy and courses modules) checked only the historical `meta.target` shape, which Prisma 7 with `@prisma/adapter-pg` does not populate; it now also checks the actual `meta.driverAdapterError.cause` shape this runtime reports. This is a backward-compatible superset check (existing `meta.target` handling is untouched); full auth/device/tenancy PostgreSQL regression to confirm no behavior change there is deferred to the next full workspace validation gate, per this task's scope.
- `git diff --check` passed (including new untracked files, checked via a temporary `git add`/`git diff --check --cached`/`git reset`).
- Full auth/device/tenancy PostgreSQL regression and the full workspace validation gate were intentionally not run this task; see the next recommended step.

Student Course Authorization/Read Slice C validation passed:

- Confirmed repository started clean at `4734994 feat(courses): add sections lessons and ordering`.
- API lint, typecheck, unit tests (unchanged, 42 passed), and build passed.
- Course Slice A+B+C PostgreSQL HTTP tests (26 tests: 4 + 10 + 12) passed together against a fresh disposable PostgreSQL 16 container with the three approved migrations applied in order; rerun twice on a freshly-truncated database to confirm determinism. `ClockService` was overridden to a fixed instant in the new test file so every `startsAt`/`endsAt` boundary assertion (future-starts denied, past-ends denied, `endsAt == now` denied, `startsAt == now` allowed) is deterministic rather than wall-clock-dependent. The unrelated `mini-inventory-system-db-1` container was not touched; the disposable container was removed after validation.
- While writing tests, confirmed empirically that "an Enrollment exists with zero `TenantStudent` row" is an unreachable database state: the composite FK `enrollments_tenant_id_student_user_id_fkey` (`Enrollment(tenantId, studentUserId) -> TenantStudent(tenantId, studentUserId)`, RESTRICT) rejects such an insert outright. The "TenantStudent not ACTIVE" test (association later deactivated while the enrollment row remains) is the reachable, and therefore correct, version of that failure mode.
- No shared authorization production code outside the courses module was modified this task, so the full auth/device/tenancy PostgreSQL regression was not re-run, per this task's scope.
- `git diff --check` passed (including new untracked files, checked via a temporary `git add`/`git diff --check --cached`/`git reset`).

Minimal Lesson Progress Slice D validation passed:

- Confirmed repository started clean at `d820a16 feat(courses): add secure student course access`.
- API lint, typecheck, unit tests (unchanged, 42 passed), and build passed.
- Course Slice A+B+C+D PostgreSQL HTTP tests (35 tests: 4 + 10 + 21) passed together against a fresh disposable PostgreSQL 16 container with the three approved migrations applied in order; rerun three times on a freshly-truncated database to confirm determinism, including the concurrent-duplicate-completion race. The existing `student-course-http.postgres-test.ts`'s `ClockService` override was made mutable (`currentNow`, reset to a fixed instant each test) so individual tests can advance the clock mid-test to prove a completion timestamp is stamped once and never silently re-stamped on a later idempotent call. The unrelated `mini-inventory-system-db-1` container was not touched; the disposable container was removed after validation.
- No shared authorization production code outside the courses module was modified this task, so the full auth/device/tenancy PostgreSQL regression was not re-run, per this task's scope.
- `git diff --check` passed.

Note: the prior task that implemented Instructor Quiz Authoring (commit `891d986`) did not update this file; that gap is closed retroactively above rather than left undocumented.

Quiz Milestone Slice B (student-safe Quiz content delivery) validation passed:

- Confirmed repository started clean at `891d986 feat(quizzes): add instructor quiz authoring`.
- API lint, typecheck, and unit tests (unchanged, 42 passed) passed.
- Quiz Slice A (instructor authoring, 15 tests) + Slice B (student delivery, 11 tests) PostgreSQL HTTP tests (26 tests total) passed together against a fresh disposable PostgreSQL 16 container with the three approved migrations applied in order.
- Course Slice A+B+C+D PostgreSQL HTTP tests (35 tests) were re-run as regression, since `StudentCourseAccessService` (shared with student Course reads) was extended with one new method; all 35 passed with no change in behavior.
- No shared auth/device/tenancy production code was modified this task (only a new one-directional module import, `QuizzesModule` -> `CoursesModule`/`DeviceModule`, and one new method added to `StudentCourseAccessService`), so the full auth/device/tenancy PostgreSQL regression was not re-run, per this task's scope.
- API build passed.
- `git diff --check` passed (including new untracked files, checked via a temporary `git add`/`git diff --check --cached`/`git reset`).
- The disposable PostgreSQL 16 container was removed after validation; the unrelated `mini-inventory-system-db-1` container was not touched.
- Verified at the raw-JSON level that the student Quiz response never contains `isCorrect` or any correct-answer/scoring field, while the instructor authoring response for the exact same `QuestionOption` still does — the primary security objective for this slice.

Quiz Milestone Slice C (student Quiz attempt creation, answer submission, and server-side scoring) validation passed:

- Confirmed repository started clean at `62a6650 feat(quizzes): add secure student quiz delivery`.
- Inspected the actual `QuizAttempt`/`QuizAttemptAnswer` schema and `docs/BACKEND-DOMAIN.md`/`docs/DATABASE-DESIGN.md`/`docs/DECISIONS.md` (DEC-0025) before writing any code; confirmed the existing schema safely supports immutable per-attempt snapshots with no migration needed — see `docs/QUIZ-ATTEMPTS.md`.
- API lint, typecheck, and unit tests (unchanged, 42 passed) passed.
- New `student-quiz-attempt-http.postgres-test.ts` (19 tests) passed against a fresh disposable PostgreSQL 16 container with the three approved migrations applied in order; rerun three times total to confirm the concurrency tests (concurrent submit, concurrent answer-vs-submit) are deterministic under the advisory-lock serialization, not flaky.
- Full Quiz Slice A+B+C PostgreSQL HTTP tests (46 tests: 15 + 12 + 19) passed together.
- Course Slice A+B+C+D PostgreSQL HTTP tests (35 tests) were re-run as regression, since `StudentCourseAccessService.assertAccessibleQuizLesson` (shared with Slice B) was extended to additionally return `enrollmentId`; all 35 passed with no change in behavior. The full Quiz+Course suite (81 tests) was also run together in one process to confirm no cross-suite interference.
- No shared auth/device/tenancy production code was modified this task (only the one new `enrollmentId` return value added to an existing Courses-module method, and new Quizzes-module files), so the full auth/device/tenancy PostgreSQL regression was not re-run, per this task's scope.
- API build passed.
- `git diff --check` passed (including new untracked files, checked via a temporary `git add`/`git diff --check --cached`/`git reset`).
- The disposable PostgreSQL 16 container was removed after validation; the unrelated `mini-inventory-system-db-1` container (and an unrelated pre-existing `n8n` container found running on the same Docker host) were not touched.
- Verified directly against persisted database state — not just HTTP responses — that: an attempt's snapshot and eventual score are unaffected by a live Question/Option edit or a live correct-option change made after the attempt started; a client-supplied score/pass payload on submit is silently ignored (the submit handler binds no request body at all); a concurrent answer-write-vs-submit race can never result in a half-transitioned attempt (exactly one of "the answer committed and is reflected in the final score" or "the answer was rejected and never appears anywhere" is true, verified for whichever ordering the race actually produced); and starting, answering, and submitting an attempt each create zero `LessonProgress` rows.

Quiz Milestone Slice C follow-up review (attempt-limit implementation, passing-threshold investigation) validation passed for the attempt-limit half; the passing-threshold half was correctly stopped rather than fixed:

- Confirmed repository started clean (Slice C's commit had not yet been made; working tree carried Slice C's uncommitted changes as the starting point for this pass).
- Inspected the actual `QuizAttempt` schema fields exhaustively before concluding no field exists to freeze a per-attempt passing-threshold snapshot, and that `QuizAttemptAnswer`'s JSON snapshot fields are documented as per-question data only, not a valid home for quiz-level grading configuration — concluded a migration is required and stopped rather than reading live state and calling it fixed, or misusing the per-question snapshot. No schema/migration change was made. See `docs/QUIZ-ATTEMPTS.md` for the exact minimal column this needs.
- Implemented and verified the `attemptLimit` V1 rule (scope, all-statuses counting, `null` = unlimited, per-Enrollment allowance) inside the existing attempt-start advisory-lock transaction; added a new narrow `QuizAttemptLimitReachedError` (409).
- API lint, typecheck, and unit tests (unchanged, 42 passed) passed.
- `student-quiz-attempt-http.postgres-test.ts` (26 tests: the prior 19 plus 7 new attempt-limit tests) passed against a fresh disposable PostgreSQL 16 container with the three approved migrations applied in order; rerun three times total to confirm the new concurrent-start-at-the-limit test is deterministic, not flaky.
- Full Quiz Slice A+B+C PostgreSQL HTTP tests (53 tests: 15 + 12 + 26) passed together.
- Course Slice A+B+C+D PostgreSQL HTTP tests (35 tests) were re-run as regression since this pass touches Quizzes-module files only (no further change to `StudentCourseAccessService` this round); all 35 passed with no change in behavior.
- API build passed.
- `git diff --check` passed (including new untracked files, checked via a temporary `git add`/`git diff --check --cached`/`git reset`).
- The disposable PostgreSQL 16 container was removed after validation; the unrelated `mini-inventory-system-db-1` container (and the unrelated pre-existing `n8n` container on the same Docker host) were not touched.
- Verified directly against persisted database state that two concurrent attempt-start requests with exactly one slot remaining converge to exactly one created attempt and one clean `QUIZ_ATTEMPT_LIMIT_REACHED` (never a raw 500), and that the final attempt count for a limited Quiz/Enrollment never exceeds the configured `attemptLimit`. Also directly proved, by inserting a row via Prisma rather than any API, that an `ABANDONED`-status attempt counts toward the limit even though no endpoint in this codebase produces that status.
- Re-ran and confirmed unchanged: immutable Question/Option/correct-answer snapshots, answer-membership validated only against the attempt's own snapshot, answer-vs-submit per-attempt serialization, submit idempotency, no answer-key leakage, no `LessonProgress` writes, and no client score/pass manipulation.

Quiz Milestone Slice C passing-threshold snapshot (approved schema change) validation passed:

- Confirmed repository started at the uncommitted Quiz Slice C working-tree state (HEAD still `62a6650 feat(quizzes): add secure student quiz delivery`).
- Verified `Quiz.passingScorePercent`'s exact existing definition (`Decimal? @db.Decimal(5, 2)`) before adding the mirrored field, rather than assuming its shape.
- Added exactly one field, `QuizAttempt.passingScorePercentSnapshot Decimal? @db.Decimal(5, 2)`, to the Prisma schema. `prisma format`, `prisma validate`, and `prisma generate` passed.
- Generated the additive migration `20260830000000_add_quiz_attempt_passing_threshold_snapshot` via `prisma migrate diff` against a disposable PostgreSQL 16 database that had the three prior approved migrations applied. Manually reviewed the generated SQL: exactly one statement, `ALTER TABLE "quiz_attempts" ADD COLUMN "passing_score_percent_snapshot" DECIMAL(5,2)` — nullable, no default, no other column/table touched.
- Applied all four migrations in order to a fresh disposable PostgreSQL 16 database and confirmed via `information_schema.columns` that the resulting column is exactly `numeric(5,2)`, `is_nullable = YES`, no default — matching `Quiz.passingScorePercent` exactly.
- Did not construct a synthetic pre-migration representative-row test: this project is pre-production with only disposable test databases, no real environment holds `quiz_attempts` rows, and PostgreSQL's own `ADD COLUMN` semantics for a nullable column with no default is a documented, fast, metadata-only operation that cannot fail or rewrite existing rows regardless of count — building a synthetic full-FK-chain row solely to re-prove that guarantee was judged unnecessary complexity per this task's own instruction.
- Updated `startAttempt` to read `Quiz.passingScorePercent` once (already inside the existing transaction, extending the same query already used for `attemptLimit`) and freeze it into `passingScorePercentSnapshot` on attempt creation; updated `submitAttempt` to compute `passed` exclusively from that frozen column, removing the live `Quiz.passingScorePercent` read entirely from the grading path.
- API lint, typecheck, and unit tests (unchanged, 42 passed) passed.
- Added 4 new PostgreSQL tests (threshold captured at start; existing attempt survives a live threshold raise while a new attempt captures the raised value; existing attempt survives a live threshold lower; client-supplied body at start cannot influence the snapshot). `student-quiz-attempt-http.postgres-test.ts` (30 tests total) passed against a fresh disposable PostgreSQL 16 container with all four migrations applied in order; rerun three times total to confirm determinism.
- Full Quiz Slice A+B+C PostgreSQL HTTP tests (57 tests: 15 + 12 + 30) passed together.
- Course Slice A+B+C+D PostgreSQL HTTP tests (35 tests) were re-run as regression (the migration is additive to `quiz_attempts` only and touches no Course-module table); all 35 passed with no change in behavior.
- API build passed.
- `git diff --check` passed (including new untracked files and the new migration directory, checked via a temporary `git add`/`git diff --check --cached`/`git reset`).
- Disposable PostgreSQL 16 containers were created and removed for migration generation and validation; the unrelated `mini-inventory-system-db-1` container (and the unrelated pre-existing `n8n` container on the same Docker host) were not touched.
- Directly verified against persisted database state (not just HTTP responses) that: `passingScorePercentSnapshot` on a freshly-started attempt matches the live threshold at that instant; an attempt started at threshold 60 that scores 70% still shows `passed: true` after the live threshold is raised to 80 (and a brand-new attempt against the same now-80 Quiz, scoring the identical 70%, shows `passed: false`); an attempt started at threshold 80 that scores 70% still shows `passed: false` after the live threshold is lowered to 60; and a client-supplied `passingScorePercentSnapshot`/`passingScorePercent`/`passed`/`status` payload sent to the start endpoint has zero effect on the created row.
- Re-ran and confirmed unchanged: immutable Question/Option/correct-answer snapshots, answer-membership validated only against the attempt's own snapshot, answer-vs-submit per-attempt serialization, submit idempotency, no answer-key leakage, no `LessonProgress` writes, no client score/pass manipulation on submit, and full `attemptLimit` semantics/concurrency (including the concurrent-start-at-the-limit test).

Quiz Milestone Slice D (Quiz completion → `LessonProgress` integration) validation passed:

- Confirmed repository started clean at `3648ed6 feat(quizzes): add secure quiz attempts and scoring`.
- Inspected the actual `LessonProgress` schema/status fields, `completeLesson`'s current implementation, `submitAttempt`'s current implementation, and `QuizAttempt`'s result fields before writing any code, per this task's own instruction not to guess the completion policy; confirmed the repository's docs did not define PASS-vs-SUBMISSION and reported that ambiguity rather than choosing — the product decision was then supplied explicitly and implemented exactly as given (see the Completed Work entry above for the full rule).
- No schema/migration change was needed or made.
- API lint, typecheck, and unit tests (unchanged, 42 passed) passed.
- Added 10 new PostgreSQL tests to `student-quiz-attempt-http.postgres-test.ts` covering the completion predicate, threshold/no-threshold behavior, existing-progress transitions (NOT_STARTED/STARTED/COMPLETED-stable), the full fail→pass→fail→pass multi-attempt sequence, submit idempotency, same-attempt and cross-attempt concurrency, ownership isolation, and that the generic manual completion endpoint still rejects QUIZ while VIDEO/DOCUMENT completion keeps working; also updated one pre-existing Slice C test (`scores a fully correct attempt at 100%...`) whose stale `lessonProgress.count() === 0` assertion predated this feature and is now correctly `1`. `student-quiz-attempt-http.postgres-test.ts` (39 tests total) passed against a fresh disposable PostgreSQL 16 container with all four existing migrations applied in order; rerun three times total to confirm the two new concurrency tests are deterministic.
- **Found and fixed a real bug during validation, not merely a test issue**: reusing the existing `create`-then-catch-unique-violation upsert pattern from within `submitAttempt`'s open transaction caused PostgreSQL to abort the entire surrounding transaction on the first (expected, anticipated) conflict, making every subsequent statement in it fail and surfacing as a 500 — reproduced directly via a test that pre-seeded an existing `LessonProgress` row. Fixed by replacing `StudentCourseAccessService.upsertCompletedProgress`'s implementation with one native PostgreSQL `INSERT ... ON CONFLICT ... DO UPDATE ... WHERE status <> 'COMPLETED'` statement, which never raises an application-level exception for the conflict/no-op case and is therefore safe both as an independent statement (`completeLesson`'s existing usage) and inside an already-open transaction (`submitAttempt`'s new usage) with no special-casing.
- Full Quiz Slice A+B+C+D PostgreSQL HTTP tests (66 tests: 15 + 12 + 39) passed together.
- Full Student Course PostgreSQL suite (35 tests, including all 9 existing Course Slice D progress tests: VIDEO/DOCUMENT completion, idempotency, STARTED transition, QUIZ rejection, cross-course rejection, per-student isolation, concurrent-duplicate-completion) was re-run as regression, since this task refactored the shared `upsertCompletedProgress` helper those tests exercise; all 35 passed with no change in observable behavior, directly confirming the refactor is behavior-preserving for the existing non-transactional call site.
- The combined Quiz+Course PostgreSQL suite (101 tests) was run together in one process against one fresh database, per this task's requirement that both `QuizAttempt` and `LessonProgress` coverage run together at least once.
- API build passed.
- `git diff --check` passed (including new untracked files, checked via a temporary `git add`/`git diff --check --cached`/`git reset`). Confirmed via `git diff --cached --name-status` that no `prisma/schema.prisma` or migration file was touched this task.
- Disposable PostgreSQL 16 containers were created and removed for validation; the unrelated `mini-inventory-system-db-1` container (and the unrelated pre-existing `n8n` container on the same Docker host) were not touched.

Media Slice A validation passed:

- Confirmed repository started clean at `66fb4e7 feat(quizzes): integrate quiz completion with lesson progress`.
- API lint, typecheck, unit tests, and build passed.
- Media PostgreSQL HTTP tests passed against a fresh disposable PostgreSQL 16 container with all four existing migrations applied in order.
- Impacted Course Section/Lesson PostgreSQL tests passed against the same disposable PostgreSQL 16 database, proving tenant-scoped VideoAsset/DocumentAsset lesson attachment behavior remains intact.
- `git diff --check` passed.
- No Prisma schema, migration, dependency, web/mobile, provider integration, upload, playback, or student media route changes were made.

Media Slice B (protected student Document Lesson access boundary) validation passed:

- Confirmed repository started clean at `3e8060e feat(media): add instructor media asset foundation`.
- Inspected the actual `DocumentAsset`/`DocumentLesson` schema (including `AssetProcessingStatus`'s `READY` state and the `(documentAssetId, tenantId) -> DocumentAsset(id, tenantId)` composite FK), `StudentCourseAccessService`, `StudentDeviceGuard`, `ClockService`, and the Quiz Slice B/C precedent (`assertAccessibleQuizLesson`, `StudentQuizService`, `QuizzesModule`'s import of `CoursesModule`/`DeviceModule`) before writing any code, per this task's own instruction to reuse rather than duplicate the canonical entitlement chain.
- No schema/migration change was needed or made — confirmed via `git diff --cached --name-status` showing no `prisma/schema.prisma` or migration file touched.
- API lint, typecheck, and unit tests (unchanged, 42 passed) passed.
- New `student-document-http.postgres-test.ts` (21 tests) passed against a fresh disposable PostgreSQL 16 container with all four existing migrations applied in order; the combined Media+Course suite (61 tests: 21 new Slice B + 5 Media Slice A + 35 Course Slice A–D) was re-run three times total to confirm determinism, and the full Media+Course+Quiz suite (127 tests) was run together once in one process to confirm no cross-suite interference.
- Directly verified via PostgreSQL tests (not just HTTP responses) that: a `DocumentLesson` cannot reference a cross-tenant `DocumentAsset` (the composite FK rejects the insert outright, proving `assertAccessibleDocumentLesson` can trust a resolved `documentAssetId` as already tenant-proven); calling the endpoint twice creates zero `LessonProgress`/`QuizAttempt` rows and leaves the `Enrollment` row's `status` unmutated; the raw JSON response never contains `documentAssetId`, `externalAssetRef`, `providerKey`, `tenantId`, `processingStatus`, or any URL/token/secret-shaped field; and every one of `UPLOADING`/`PROCESSING`/`FAILED`/`ARCHIVED` `DocumentAsset.processingStatus` values denies access while `READY` (including a live transition from `PROCESSING` to `READY` mid-test) grants it.
- API build passed.
- `git diff --check` passed (including new untracked files, checked via a temporary `git add`/`git diff --check --cached`/`git reset`).
- A disposable PostgreSQL 16 container (`edvora-media-slice-b-test-db`) was created and removed after validation; the unrelated `mini-inventory-system-db-1` container (and an unrelated pre-existing `goofy_solomon` container on the same Docker host) were not touched.
- Historical Slice B note: at that checkpoint no provider port or signed document capability existed yet. Current R2 upload/download behavior supersedes that part of the old validation note; there is still no HTTP route resembling `/student/documents/:documentAssetId`.

Media Slice C (protected student Video Lesson playback authorization boundary) validation passed:

- Confirmed repository started clean at `9905b1c feat(media): add protected student document access`.
- Reused the Media/Course context already established in this session (Document Slice B); inspected the actual `VideoAsset`/`VideoLesson` schema (confirming `AssetProcessingStatus.READY` and the `(videoAssetId, tenantId) -> VideoAsset(id, tenantId)` composite FK are structurally identical to `DocumentAsset`/`DocumentLesson`) before writing any code.
- No schema/migration change was needed or made — confirmed via `git diff --cached --name-status` showing no `prisma/schema.prisma` or migration file touched.
- API lint, typecheck, and unit tests (unchanged, 42 passed) passed.
- New `student-video-http.postgres-test.ts` (22 tests) passed against a fresh disposable PostgreSQL 16 container with all four existing migrations applied in order; the combined Media+Course suite (83 tests: 22 new Slice C + 21 Slice B + 5 Slice A + 35 Course Slice A–D) was re-run three times total to confirm determinism, and the full Media+Course+Quiz suite (149 tests) was run together once in one process to confirm no cross-suite interference — including explicitly re-running the existing Course Slice D VIDEO-lesson progress tests, since VIDEO progress behavior already existed before this slice.
- Directly verified via PostgreSQL tests (not just HTTP responses) that: a `VideoLesson` cannot reference a cross-tenant `VideoAsset` (the composite FK rejects the insert outright); calling the endpoint twice creates zero `LessonProgress`/`QuizAttempt` rows and leaves the `Enrollment` row's `status` unmutated; the pre-existing generic manual VIDEO-lesson completion endpoint (`POST .../complete`) still works exactly as before and is entirely unaffected by calling the new playback-authorization endpoint (before or after completion); the raw JSON response never contains `videoAssetId`, `externalAssetRef`, `providerKey`, `tenantId`, `processingStatus`, or any URL/token/playback/DRM-shaped field; and every one of `UPLOADING`/`PROCESSING`/`FAILED`/`ARCHIVED` `VideoAsset.processingStatus` values denies access while `READY` (including a live transition from `PROCESSING` to `READY` mid-test) grants it.
- API build passed.
- `git diff --check` passed (including new untracked files, checked via a temporary `git add`/`git diff --check --cached`/`git reset`).
- A disposable PostgreSQL 16 container (`edvora-media-slice-c-test-db`) was created and removed after validation; the unrelated `mini-inventory-system-db-1` container (and the unrelated pre-existing `goofy_solomon` container on the same Docker host) were not touched.
- No formal provider-port interface was introduced (same rationale as Slice B, documented in `docs/MEDIA.md`); no HTTP route resembling `/student/videos/:videoAssetId` was added; no playback URL, signed URL, playback token, DRM license, or provider credential was fabricated anywhere in the response or tests. Media Slice A's instructor VideoAsset routes/response fields were not modified.

Note: Media Slice D (secure R2 document uploads), the protected R2 document download capability
route, and the Bunny Stream video upload/processing lifecycle (`c8946c6`) were implemented in
sessions between Slice C and Slice G below without a corresponding entry added to this validation
log at the time; that gap is not backfilled here to avoid misrepresenting validation that was not
directly observed by this task.

Media Slice G (protected Bunny video playback capability) validation passed:

- Confirmed repository started clean at `c8946c6 feat(media): add Bunny video upload lifecycle`.
- Read `AGENTS.md`, `docs/MEDIA.md`, `docs/STATUS.md`, `StudentCourseAccessService.assertAccessibleVideoLesson`, the student video controller/service/types, the Slice F Bunny provider/config/tests, and the `VideoAsset`/`VideoLesson` schema before writing any code.
- Researched Bunny's current official documentation and its official reference token-signing implementation (`github.com/BunnyWay/BunnyCDN.TokenAuthentication`) rather than relying on prior notes, and independently verified the exact HMAC-SHA256 directory-token construction byte-for-byte against that repository's own published test vectors in a standalone script before writing any provider code.
- Extended `VideoProvider` with `createPlaybackCapability`; implemented it in `BunnyStreamVideoProvider` using Bunny's CDN Pull Zone directory (path-style) token authentication, scoped to each video's own `/{videoId}/` storage prefix, protecting the HLS manifest and every segment/quality file together — not merely Bunny's separate embed/iframe view token, and not a query-string token on the manifest alone.
- Extended `StudentCourseAccessService.assertAccessibleVideoLesson` to additionally return the proven READY asset's `providerKey`/`externalAssetRef` (no schema/migration change; confirmed via `git diff --cached --name-status` showing no `prisma/schema.prisma` or migration file touched).
- Added `VideoAssetProviderInvariantViolationError`/`VIDEO_ASSET_PROVIDER_INVARIANT_VIOLATION` (library mismatch) and `VideoPlaybackSigningFailedError`/`VIDEO_PLAYBACK_SIGNING_FAILED` (malformed GUID), both `502`, both leaving `VideoAsset` state untouched.
- Added new Bunny provider unit tests (`bunny-stream-video.provider.spec.ts`) proving deterministic construction against an independently-reproduced reference formula, that changing the video ID/expiry/security key changes the token, that the URL uses the path-style `/bcdn_token=` form (never `?token=` on the manifest), and that malformed video IDs are rejected rather than signed.
- API lint, typecheck, and unit tests (57 passed, up from 51: 6 new provider tests) passed.
- Extended `student-video-http.postgres-test.ts`'s `FakeVideoProvider` with `createPlaybackCapability` (recording every requested `(videoId, expiresInSeconds, now)` and supporting simulated signing failure) and its `createVideoAssetDirect` test helper to persist a matching `providerKey`/valid-GUID-shaped `externalAssetRef` (the prior helper omitted `providerKey` entirely, which the new service-level provider-identity check would otherwise correctly reject). Rewrote the response-shape assertions for the new `lessonId`/`durationSeconds`/`playbackUrl`/`expiresAt` shape and added new tests: exact provider video/TTL used for signing, TTL bounds for short/long/unknown-duration videos, Bunny library mismatch rejected, provider signing failure leaves `VideoAsset`/`Enrollment`/progress state unchanged and a subsequent call still succeeds, and repeated calls issue independent fresh capabilities with no persisted row. All pre-existing Slice C authorization-denial coverage (device/TenantStudent/Enrollment/lifecycle/availability/lesson-type/cross-tenant/IDOR/readiness) was preserved unchanged.
- A fresh disposable PostgreSQL 16 container was created; all four existing migrations were applied in order (no new migration). The full Postgres integration suite (`test:auth:postgres`, 14 suites, 222 tests, spanning auth/device/tenancy/course/quiz/media) passed together in one process, confirming Slice F's Bunny upload/webhook lifecycle, Media Slice A/B, and Course/Quiz regression are all unaffected by the `VideoProvider` interface change.
- API build and root `corepack pnpm check` (install, prisma generate, lint, typecheck, test, API build, web build) passed.
- `git diff --check` passed.
- The disposable PostgreSQL 16 container was removed after validation; the unrelated `mini-inventory-system-db-1` container was not touched.
- Verified directly: the raw JSON response never contains `videoAssetId`, `tenantId`, `providerKey`, `externalAssetRef`, or any Bunny credential value (API key, webhook signing secret, token authentication key); `playbackUrl` targets the exact authorized video's `/{videoId}/playlist.m3u8` path; TTL is computed as `clamp(duration + 900, 300, 14400)` with a 7200s fallback for unknown duration; and no `LessonProgress`/`QuizAttempt`/`SecurityEvent` row is created by any playback-authorization call, including a failed one.
- No migration was required or added. No mobile UI was implemented — this slice is API-only, and the response (`playbackUrl` consumable directly by a native HLS player, no per-segment backend calls) is designed to be ready for that future integration.

## Exact Recommended Next Step

Media provider/upload/playback foundations are now complete for V1 (documents on Cloudflare R2,
video on Bunny Stream Standard Network, including real signed HLS playback issuance). Remaining
media work is operational, not architectural: cleanup for abandoned uploads/orphan provider objects,
optional document download-header refinements, and any future DRM (Bunny MediaCage) integration if a
later threat model requires it.

Design an attempt result/review screen on top of the now-complete Quiz attempt/scoring/completion
engine (Slices C and D). Begin the actual mobile video/document player integration (the API side is
now ready for a native HLS player consuming `playbackUrl` directly). Also run a full
auth/device/tenancy/workspace validation gate, since none has been run since the Course Slice B
review's shared-utility fix.

## Handoff Instructions

Future Codex/Cursor sessions must read `AGENTS.md` and all relevant files in `docs/` before modifying code or architecture. Do not rely on chat history as the source of truth.
