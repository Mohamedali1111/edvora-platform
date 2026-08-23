# Edvora Platform

Edvora is a security-first bilingual EdTech SaaS platform for instructors and their students.

This repository is in early foundation phase. It contains minimal framework foundations for the student mobile app, instructor/admin web app, shared backend API, reviewed database schema/migration artifacts, and the API database runtime boundary. It does not yet contain product features, authentication, product repositories, payments, or security implementation.

## Current Architecture

- Student mobile app: Expo SDK 57 + React Native + TypeScript + Expo Router.
- Instructor and Platform Admin dashboard: Next.js App Router + TypeScript + Tailwind CSS.
- Backend API: NestJS + TypeScript.
- Database: PostgreSQL planned; initial reviewed migration exists and the API has a Prisma/PostgreSQL runtime boundary.
- ORM: Prisma 7 schema foundation implemented for the API.
- Monorepo: pnpm workspaces.

V1 has no student in-app payment, course checkout, or subscription purchase flow. Instructor billing is handled externally/manual outside the student mobile app.

## Repository Structure

```text
edvora-platform/
|-- apps/
|   |-- api/
|   |-- mobile/
|   `-- web/
|-- packages/
|-- docs/
|-- AGENTS.md
|-- package.json
|-- pnpm-workspace.yaml
`-- README.md
```

`packages/` is intentionally empty until real shared code exists.

## Local Prerequisites

- Node.js 22.23.2.
- Corepack enabled.
- pnpm 10.34.5, pinned by the root `packageManager` field.

## Setup

```bash
corepack enable
pnpm install
```

If a local pnpm config forces offline mode, use:

```bash
pnpm install --config.offline=false
```

## Development Commands

```bash
pnpm dev:api
pnpm dev:web
pnpm dev:mobile
```

## Validation Commands

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build:api
pnpm build:web
pnpm check
```

API Prisma schema commands:

```bash
pnpm --filter @edvora/api prisma:format
pnpm --filter @edvora/api prisma:validate
pnpm --filter @edvora/api prisma:generate
```

Prisma uses `apps/api/prisma.config.ts` and a safe placeholder database URL for non-runtime Prisma commands when `DATABASE_URL` is not set. Starting the API runtime requires a real local/runtime `DATABASE_URL`; use `apps/api/.env.example` as the shape only and never commit real credentials.

Migration SQL is reviewed before application. See `docs/MIGRATIONS.md` before creating or applying database migrations.

Mobile store builds are not local root scripts. Future native development/custom builds should use Expo/EAS workflows after the app identity and build profiles are deliberately configured.

## Documentation

Start here:

- `AGENTS.md`
- `docs/PRODUCT.md`
- `docs/ARCHITECTURE.md`
- `docs/SECURITY.md`
- `docs/UI-GUIDELINES.md`
- `docs/RELEASE-COMPLIANCE.md`
- `docs/RELIABILITY.md`
- `docs/DATABASE-CONSTRAINTS.md`
- `docs/MIGRATIONS.md`
- `docs/DECISIONS.md`
- `docs/STATUS.md`

## Status

Edvora is under active development. The current applications are framework scaffolds only.
