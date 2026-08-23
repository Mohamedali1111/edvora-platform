# Project Status

## Project

Edvora Platform

## Current Phase

Initial Prisma schema implementation completed for the backend database foundation. The repository has minimal framework foundations for API, web, and mobile, with no product features, database connection, or migrations.

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
- Preserved the existing Git repository and root pnpm lockfile model.

## Current Architecture Baseline

- Monorepo using pnpm workspaces.
- Apps: `apps/mobile`, `apps/web`, and `apps/api`.
- Current stack: Expo SDK 57 + React Native + Expo Router + TypeScript, Next.js 16 + TypeScript, NestJS 11 + TypeScript.
- Planned data layer is PostgreSQL + Prisma. Prisma schema is implemented; PostgreSQL connection and migrations are not created yet.
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
- ORM tooling: Prisma 7.9.1 and `@prisma/client` 7.9.1.
- Web: Next.js 16.3.2, React 19.2.8, Tailwind CSS 4.3.3.
- Mobile: Expo 57.0.15, Expo Router 57.0.15, React Native 0.86.2, React 19.2.3.

## Known Issues / Warnings

- No product functionality exists yet.
- No Prisma migrations, database connection, seed data, or product modules exist yet.
- Prisma v7 requires generated client output to use an explicit path. The current output path is `apps/api/.generated/prisma`, which is intentionally ignored because no application code imports Prisma Client yet.
- Several PostgreSQL-only constraints are documented in `docs/DATABASE-CONSTRAINTS.md` and must be added during migration work.
- No CI/CD exists yet.
- pnpm dependency installation may need `--config.offline=false` on machines with a global pnpm `offline=true` setting.
- Next.js build may require normal process-spawn permissions on Windows because it uses worker processes.
- No iOS Simulator or physical-device validation was performed on Windows.

## Pending Decisions

- Video/security provider selection after dedicated technical and cost evaluation.
- Final visual branding, fonts, colors, and logo.
- Authentication/session implementation details.
- Final password hashing/session implementation details.
- Prisma 7 PostgreSQL runtime integration details, including whether a driver adapter such as `@prisma/adapter-pg` is required.
- Final legal/privacy retention policy for account deletion and security events.
- Final UUIDv7 generation mechanism: application-generated UUIDv7 values or a reviewed PostgreSQL function/default before first real writes.
- App Store bundle identifiers and Android application IDs.
- EAS build profiles and production build identity.
- Deployment target and production infrastructure.

## Intentionally Deferred Work

- Product feature implementation.
- Authentication and authorization.
- PostgreSQL connection, migrations, seed data, and database runtime integration.
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

## Exact Recommended Next Step

Create the first reviewed PostgreSQL migration plan for the Prisma schema, including the deferred PostgreSQL-only constraints, without connecting production infrastructure.

## Handoff Instructions

Future Codex/Cursor sessions must read `AGENTS.md` and all relevant files in `docs/` before modifying code or architecture. Do not rely on chat history as the source of truth.
