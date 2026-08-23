# Project Status

## Project

Edvora Platform

## Current Phase

Backend domain and database architecture design completed. The repository has minimal framework foundations for API, web, and mobile, with no product features or database implementation.

## Completed Work

- Established root documentation for product, architecture, security, UI, release compliance, reliability, decisions, and future handoffs.
- Established a pnpm workspace monorepo foundation.
- Scaffolded `apps/api` as a minimal NestJS TypeScript application.
- Scaffolded `apps/web` as a minimal Next.js App Router TypeScript application with Tailwind CSS.
- Scaffolded `apps/mobile` as a minimal Expo SDK 57 React Native TypeScript application with Expo Router.
- Designed the V1 backend domain model in `docs/BACKEND-DOMAIN.md`.
- Designed the V1 relational database model in `docs/DATABASE-DESIGN.md`.
- Preserved the existing Git repository and root pnpm lockfile model.

## Current Architecture Baseline

- Monorepo using pnpm workspaces.
- Apps: `apps/mobile`, `apps/web`, and `apps/api`.
- Current stack: Expo SDK 57 + React Native + Expo Router + TypeScript, Next.js 16 + TypeScript, NestJS 11 + TypeScript.
- Planned data layer remains PostgreSQL + Prisma, not implemented yet.
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
- Web: Next.js 16.3.2, React 19.2.8, Tailwind CSS 4.3.3.
- Mobile: Expo 57.0.15, Expo Router 57.0.15, React Native 0.86.2, React 19.2.3.

## Known Issues / Warnings

- No product functionality exists yet.
- No Prisma schema, migrations, database connection, or product modules exist yet.
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
- Prisma/database setup.
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

## Exact Recommended Next Step

Create the initial Prisma schema draft from the approved database design without connecting PostgreSQL or adding migrations.

## Handoff Instructions

Future Codex/Cursor sessions must read `AGENTS.md` and all relevant files in `docs/` before modifying code or architecture. Do not rely on chat history as the source of truth.