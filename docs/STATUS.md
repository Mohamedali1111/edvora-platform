# Project Status

## Project

Edvora Platform

## Current Phase

Initial Prisma schema, reviewed PostgreSQL migration artifact, and NestJS Prisma/PostgreSQL runtime foundation completed. The repository has minimal framework foundations for API, web, and mobile, with no product features or product domain repositories.

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
- Preserved the existing Git repository and root pnpm lockfile model.

## Current Architecture Baseline

- Monorepo using pnpm workspaces.
- Apps: `apps/mobile`, `apps/web`, and `apps/api`.
- Current stack: Expo SDK 57 + React Native + Expo Router + TypeScript, Next.js 16 + TypeScript, NestJS 11 + TypeScript.
- Planned data layer is PostgreSQL + Prisma. Prisma schema and the first reviewed migration SQL artifact are implemented and have been validated against disposable PostgreSQL 16.
- The API has a Nest-managed Prisma 7 runtime boundary using the official PostgreSQL adapter and one `pg` pool per API process.
- Backend domain/database design covers canonical users, tenant memberships, enrollments, devices, content, quizzes, progress, notifications, security events, deletion lifecycle, UUIDv7-compatible IDs, and concurrency-sensitive operations.
- V1 roles: `STUDENT`, `INSTRUCTOR`, `PLATFORM_ADMIN`.
- Multi-tenant SaaS from the beginning.
- Student device authorization defaults to one approved active device, with configurable architecture.
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
- Authentication/session implementation details.
- Final password hashing/session implementation details.
- Final legal/privacy retention policy for account deletion and security events.
- App Store bundle identifiers and Android application IDs.
- EAS build profiles and production build identity.
- Deployment target and production infrastructure.

## Intentionally Deferred Work

- Product feature implementation.
- Authentication and authorization.
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

## Exact Recommended Next Step

Design the first authentication/session implementation plan without creating product endpoints yet.

## Handoff Instructions

Future Codex/Cursor sessions must read `AGENTS.md` and all relevant files in `docs/` before modifying code or architecture. Do not rely on chat history as the source of truth.
