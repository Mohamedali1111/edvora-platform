# Migrations

Edvora database migrations are reviewed artifacts. A migration should be readable before it is applied to any shared database.

## Philosophy

- Generate migration SQL from the Prisma schema when possible.
- Review generated SQL manually before it is accepted.
- Add PostgreSQL-specific constraints in the migration file when Prisma schema syntax cannot represent them accurately.
- Do not apply migrations to production, staging, or shared environments without a release plan.
- Do not edit migrations that have already been applied in shared environments. Create a new migration instead.

## Current Prisma 7 Workflow

The initial migration was generated without connecting to any database:

```bash
pnpm --filter @edvora/api exec prisma migrate diff \
  --config prisma.config.ts \
  --from-empty \
  --to-schema prisma/schema.prisma \
  --script \
  --output prisma/migrations/20260823000000_initial_schema/migration.sql
```

This uses the official Prisma `migrate diff` workflow to compare an empty source with the current Prisma schema and write PostgreSQL SQL for review.

## Naming

Migration directories should use Prisma's conventional timestamped shape:

```text
YYYYMMDDHHMMSS_short_description/
```

Example:

```text
20260823000000_initial_schema/
```

## PostgreSQL-Specific SQL

Some Edvora invariants require PostgreSQL features not represented in `schema.prisma`, such as partial unique indexes and check constraints. These additions belong in reviewed migration SQL with clear comments and matching documentation in `docs/DATABASE-CONSTRAINTS.md`.

A regenerated Prisma diff is not automatically equivalent to an approved Edvora migration; PostgreSQL-specific additions must be preserved or re-reviewed before replacement.

Do not use provider-specific extensions or newest-version-only functions unless the database platform/version decision has been made and documented.

## Environment Expectations

Local development may generate and review migration SQL without applying it. Applying migrations requires an explicit disposable local database or approved shared environment workflow.

Staging and production migrations must be planned. Destructive migrations require backup/restore awareness, rollback planning, and compatibility review.

## Mobile Compatibility

Because mobile clients may run older app versions, future schema changes should prefer expand/contract migrations:

- Add nullable/new structures first.
- Deploy backend support that can read/write both old and new shapes where needed.
- Backfill safely.
- Remove old fields only after compatible clients and backend code are deployed.

## Safety Rules

- No production credentials in migration files.
- No seed data in schema migrations.
- No Docker/cloud provisioning as part of a migration file.
- No manual editing of already-applied shared migrations.
- Run Prisma validation, API validation, root checks, and `git diff --check` before requesting review.
