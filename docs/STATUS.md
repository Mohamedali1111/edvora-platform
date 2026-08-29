# Project Status

## Project

Edvora Platform

## Current Phase

Initial Prisma schema, reviewed PostgreSQL migration artifacts, NestJS Prisma/PostgreSQL runtime foundation, authentication/session security design, V1 account onboarding decisions, auth one-time token persistence, internal auth/security primitives, internal auth use-case orchestration, the first public auth HTTP boundary, student device authorization foundation, tenant-student association design, and tenant-student persistence are completed. The repository has minimal framework foundations for API, web, and mobile, with no tenancy/enrollment service implementation yet.

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

- No product functionality exists yet.
- No seed data, product modules, or product repositories exist yet.
- Tenant/instructor/student/enrollment APIs remain pending; `TenantStudent` persistence is implemented, but no service/API layer exists yet.
- Authentication/session behavior and V1 onboarding decisions are designed; internal primitives, orchestration services, public auth HTTP transport, and student device authorization foundation exist.
- Authentication one-time token persistence, internal generation/hashing/consumption services, login orchestration, activation completion, refresh orchestration, logout, password change, password-reset completion, HTTP DTO validation, auth route throttling, Bearer guard, web refresh cookies, trusted-origin checks, device authorization routes, and Platform Admin device-change review routes exist. Delivery, mobile storage, tenant authorization, course/content authorization, and distributed rate limiting are not implemented.
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

- Product domain feature implementation.
- Tenant/course authorization and device authorization.
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

## Exact Recommended Next Step

Review the implemented `TenantStudent` persistence migration results, then implement tenant/instructor/student/enrollment services and APIs in a separate task.

## Handoff Instructions

Future Codex/Cursor sessions must read `AGENTS.md` and all relevant files in `docs/` before modifying code or architecture. Do not rely on chat history as the source of truth.
