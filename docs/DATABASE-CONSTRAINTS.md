# Database Constraints Deferred to Migrations

This document lists database invariants required by the approved Edvora V1 design that are not represented fully in the initial Prisma schema. They must be reviewed when PostgreSQL migrations are introduced.

The Prisma schema is the application model source of truth, but production integrity must also use PostgreSQL constraints where Prisma schema syntax cannot express the invariant honestly.

## UUIDv7 ID Generation

- Invariant: Public primary IDs should be UUIDv7-compatible values stored as PostgreSQL `uuid`.
- Intended PostgreSQL concept: Either application-generated UUIDv7 values or a reviewed PostgreSQL UUIDv7 generation function/default.
- Prisma limitation: Prisma can model fields as `String @db.Uuid`, but the schema does not provide a native true UUIDv7 default generator.
- Migration timing: Decide and implement the final generation mechanism before the first real migration/application write path.

## One Active Student Device

- Invariant: V1 defaults to one active approved student device per student, while keeping the future limit policy-configurable.
- Intended PostgreSQL concept: A partial unique index such as one unique `student_user_id` where `status = 'ACTIVE'`, possibly adjusted once device-limit policy tables exist.
- Prisma limitation: Prisma schema cannot accurately define PostgreSQL partial unique indexes.
- Migration timing: Add before any production device authorization workflow is enabled.

## One Pending Device-Change Request Per Student

- Invariant: A student should not accumulate multiple competing pending device-change requests for the same replacement workflow.
- Intended PostgreSQL concept: A partial unique index on `student_user_id` where `status = 'PENDING'`.
- Prisma limitation: Prisma schema cannot accurately define this partial unique index.
- Migration timing: Add before Platform Admin device-change review is implemented.

## Active Enrollment Uniqueness

- Invariant: A student should not have duplicate active access records for the same tenant/course.
- Intended PostgreSQL concept: A partial unique index on `(student_user_id, course_id)` where `status = 'ACTIVE'`.
- Prisma limitation: A normal `@@unique` would incorrectly block retained historical enrollment rows for the same student/course. The initial schema uses indexes for access checks and defers the partial uniqueness rule.
- Migration timing: Add before enrollment creation/revocation logic is implemented.

## Conditional Ordering Uniqueness

- Invariant: Active/non-archived section, lesson, question, and option positions should be unique within their parent.
- Intended PostgreSQL concept: Partial unique indexes scoped by parent and `position`, excluding archived rows if archived rows are allowed to retain old positions.
- Prisma limitation: Prisma can define normal unique constraints, but not partial unique constraints. The initial schema uses normal uniqueness for simple deterministic ordering where safe; future archival behavior may require partial variants.
- Migration timing: Revisit before implementing archival and reorder behavior.

## Check Constraints

- Invariant: Numeric and lifecycle fields should remain valid.
- Intended PostgreSQL concept: Check constraints for non-negative positions, points, durations, progress seconds, valid score percentages, and date ranges such as `starts_at <= ends_at`.
- Prisma limitation: Prisma schema does not cover these PostgreSQL checks comprehensively.
- Migration timing: Add with the first migration that creates the affected tables.

## Lesson Detail Consistency

- Invariant: Each `Lesson` must have exactly one type-specific detail row matching its `type`.
- Intended PostgreSQL concept: Enforce through transactions and potentially database triggers or deferred constraints if needed.
- Prisma limitation: Prisma can model one-to-one detail relations, but cannot express "exactly one of these relations, matching this enum value" as a schema constraint.
- Migration timing: Implement in domain logic first; consider database enforcement before protected content authoring reaches production.

## Bounded JSON Payloads

- Invariant: Quiz attempt snapshots and security event metadata must stay bounded and scrubbed of secrets.
- Intended PostgreSQL concept: Application validation plus optional PostgreSQL checks on JSON shape/size if operationally necessary.
- Prisma limitation: Prisma can use PostgreSQL JSONB, but cannot define detailed payload schemas or secret scrubbing.
- Migration timing: Define application validators before write paths; add database checks only if they materially improve safety.
