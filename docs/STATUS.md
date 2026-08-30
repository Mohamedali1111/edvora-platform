# Project Status

## Project

Edvora Platform

## Current Phase

Initial Prisma schema, reviewed PostgreSQL migration artifacts, NestJS Prisma/PostgreSQL runtime foundation, authentication/session security design, V1 account onboarding decisions, auth one-time token persistence, internal auth/security primitives, internal auth use-case orchestration, the first public auth HTTP boundary, student device authorization foundation, tenant-student association design, tenant-student persistence, the first tenancy/enrollment service/API foundation, Instructor Course Core Slice A, Instructor Course Sections/Lessons/Ordering Slice B, and Student Course Authorization/Read Slice C are completed. The repository has minimal framework foundations for API, web, and mobile; protected content delivery (video/document/quiz), lesson progress, and course lifecycle transitions are not implemented yet.

## Completed Work

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
- Course authoring Slice A (core course metadata), Slice B (Section/Lesson create, metadata update, archive, and whole-list reorder), and Slice C (student course authorization/read) exist. Lesson creation for VIDEO/DOCUMENT/QUIZ types requires the instructor to reference an already-existing tenant-scoped VideoAsset/DocumentAsset/Quiz row by ID; this milestone does not add any way to create those referenced rows (no upload flow, no quiz authoring), so real end-to-end lesson creation for a given type is gated on that future work landing. A currently-unavailable lesson (before `availableFrom` or at/after `availableUntil`) is omitted entirely from the student structure response rather than returned as locked metadata — the conservative choice since neither `docs/PRODUCT.md` nor `docs/BACKEND-DOMAIN.md` specify this, and omission leaks no title/type/existence about content the student cannot yet reach. Course lifecycle transitions, lesson progress, protected video/document/quiz content delivery (playback authorization, document access, quiz execution), uploads, quiz authoring, and frontend/mobile course UI remain pending.
- Authentication/session behavior and V1 onboarding decisions are designed; internal primitives, orchestration services, public auth HTTP transport, and student device authorization foundation exist.
- Authentication one-time token persistence, internal generation/hashing/consumption services, login orchestration, activation completion, refresh orchestration, logout, password change, password-reset completion, HTTP DTO validation, auth route throttling, Bearer guard, web refresh cookies, trusted-origin checks, device authorization routes, and Platform Admin device-change review routes exist. Delivery, mobile storage, tenant authorization, course/content authorization, and distributed rate limiting are not implemented.
- Platform Admin instructor onboarding, instructor tenant/student/enrollment APIs, instructor course metadata APIs, instructor course section/lesson authoring APIs, and student course authorization/read APIs exist. Activation delivery, student removal endpoints, course lifecycle transitions, protected content delivery (video/document/quiz), lesson progress, and distributed rate limiting are not implemented.
- Runtime API startup requires a valid `DATABASE_URL`; build/typecheck/unit tests do not require a live database.
- Prisma v7 generated client output uses the explicit path `apps/api/.generated/prisma`, which is intentionally ignored. API build emits a compiled generated client under ignored build output.
- PostgreSQL-only constraints are tracked in `docs/DATABASE-CONSTRAINTS.md`; partial unique indexes and stable check constraints are represented in the initial migration SQL, while lesson detail integrity and JSON payload limits remain application-controlled.
- No CI/CD exists yet.
- pnpm dependency installation may need `--config.offline=false` on machines with a global pnpm `offline=true` setting.
- Next.js build may require normal process-spawn permissions on Windows because it uses worker processes.
- No iOS Simulator or physical-device validation was performed on Windows.

## Pending Decisions

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

## Exact Recommended Next Step

Implement Slice D: targeted LessonProgress reads/writes (own-progress-only, idempotent non-quiz-lesson completion) scoped by the same entitlement chain `StudentCourseAccessService` now proves, then design the protected video/document access and quiz-execution boundaries as separate, later endpoints per `docs/DECISIONS.md`'s DRM-ready-not-DRM-implemented requirement.

## Handoff Instructions

Future Codex/Cursor sessions must read `AGENTS.md` and all relevant files in `docs/` before modifying code or architecture. Do not rely on chat history as the source of truth.
