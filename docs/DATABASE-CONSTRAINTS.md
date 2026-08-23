# Database Constraints Deferred to Migrations

This document lists database invariants required by the approved Edvora V1 design that are not represented fully in the initial Prisma schema. They must be reviewed when PostgreSQL migrations are introduced.

The Prisma schema is the application model source of truth, but production integrity must also use PostgreSQL constraints where Prisma schema syntax cannot express the invariant honestly.

## UUIDv7 ID Generation

- Invariant: Public primary IDs should be UUIDv7-compatible values stored as PostgreSQL `uuid`.
- Current migration status: Deferred from SQL. Columns are PostgreSQL `uuid` without defaults.
- Intended concept: Generate UUIDv7 in application code until Edvora selects a PostgreSQL platform/version that makes a database default portable and justified.
- Prisma limitation: Prisma can model fields as `String @db.Uuid`, but the schema does not provide a native true UUIDv7 default generator.
- Reason: PostgreSQL-native `uuidv7()` is available in PostgreSQL 18, but Edvora has not selected a provider or minimum PostgreSQL major version. The initial migration avoids locking the platform to PostgreSQL 18 or a niche extension.
- Migration timing: Decide and implement the final generation mechanism before the first real application write path.

## One Active Student Device

- Invariant: V1 defaults to one active approved student device per student, while keeping the future limit policy-configurable.
- Current migration status: Implemented as a PostgreSQL partial unique index on `student_devices(student_user_id)` where `status = 'ACTIVE'`.
- Intended PostgreSQL concept: A partial unique index for the V1 default, possibly adjusted once device-limit policy tables exist.
- Prisma limitation: Prisma schema cannot accurately define PostgreSQL partial unique indexes.
- Remaining work: Device-switching must still use transactions so status changes and security events are atomic.

## One Pending Device-Change Request Per Student

- Invariant: A student should not accumulate multiple competing pending device-change requests for the same replacement workflow.
- Current migration status: Implemented as a PostgreSQL partial unique index on `device_change_requests(student_user_id)` where `status = 'PENDING'`.
- Intended PostgreSQL concept: A partial unique index on `student_user_id` where `status = 'PENDING'`.
- Prisma limitation: Prisma schema cannot accurately define this partial unique index.
- Remaining work: Request creation/review must still close or expire old requests transactionally.

## Active Enrollment Uniqueness

- Invariant: A student should not have duplicate active access records for the same tenant/course.
- Current migration status: Implemented as a PostgreSQL partial unique index on `enrollments(student_user_id, course_id)` where `status = 'ACTIVE'`.
- Intended PostgreSQL concept: A partial unique index on `(student_user_id, course_id)` where `status = 'ACTIVE'`.
- Prisma limitation: A normal `@@unique` would incorrectly block retained historical enrollment rows for the same student/course. The initial schema uses indexes for access checks and defers the partial uniqueness rule.
- Remaining work: Date-based expiration still depends on transactional/application logic updating or interpreting `status`, `starts_at`, and `ends_at`.

## Conditional Ordering Uniqueness

- Invariant: Active/non-archived section, lesson, question, and option positions should be unique within their parent.
- Current migration status: Enforced by normal unique indexes for the current simple V1 lifecycle.
- Intended PostgreSQL concept: Partial unique indexes scoped by parent and `position`, excluding archived rows if archived rows are allowed to retain old positions.
- Prisma limitation: Prisma can define normal unique constraints, but not partial unique constraints. The initial schema uses normal uniqueness for simple deterministic ordering where safe; future archival behavior may require partial variants.
- Migration timing: Revisit before implementing archival and reorder behavior.

## Check Constraints

- Invariant: Numeric and lifecycle fields should remain valid.
- Current migration status: Implemented for stable mathematical/date invariants including non-negative positions, points, durations, file sizes, progress seconds, quiz score bounds, quiz attempt sequence, simple date ordering, and auth-token timestamp ordering.
- Intended PostgreSQL concept: Check constraints for non-negative positions, points, durations, progress seconds, valid score percentages, and date ranges such as `starts_at <= ends_at`.
- Prisma limitation: Prisma schema does not cover these PostgreSQL checks comprehensively.
- Remaining work: Business-state transitions, reveal policy, completion semantics, and status/timestamp consistency remain application-controlled.

## Auth One-Time Token Timestamp Integrity

- Invariant: Account activation and password reset tokens must expire after creation, and consumed/revoked timestamps must not precede creation.
- Current migration status: Implemented in `20260823010000_add_auth_security_tokens` with PostgreSQL CHECK constraints on `account_activation_tokens` and `password_reset_tokens`.
- Intended PostgreSQL concept: Stable timestamp-ordering CHECK constraints.
- Prisma limitation: Prisma schema cannot express CHECK constraints.
- Remaining work: Token generation, hashing, single-use consumption, issuing a replacement token, and revoking older outstanding tokens must be implemented in transactional application logic. No time-dependent partial indexes using `NOW()` are used.

## Auth One-Time Outstanding Token Policy

- Invariant: Product workflows may choose to keep at most one outstanding activation or reset token per user by revoking older unconsumed tokens when a new token is issued.
- Current migration status: Application-enforced, not a database partial unique index.
- Intended PostgreSQL concept: Avoid volatile time-dependent predicates such as `expires_at > now()` in partial indexes.
- Prisma limitation: Prisma cannot express partial unique indexes, and a status-only partial index would not account for expiry without lifecycle updates.
- Remaining work: Issuance flows must transactionally revoke prior unconsumed/unrevoked tokens before creating a replacement if the workflow requires only one outstanding token.

## Lesson Detail Consistency

- Invariant: Each `Lesson` must have exactly one type-specific detail row matching its `type`.
- Current migration status: Deferred from database triggers. The migration enforces type-specific detail table relationships and tenant consistency, but not the cross-table "exactly one matching detail row" invariant.
- Intended PostgreSQL concept: Enforce through transactions and potentially database triggers or deferred constraints if needed.
- Prisma limitation: Prisma can model one-to-one detail relations, but cannot express "exactly one of these relations, matching this enum value" as a schema constraint.
- Migration timing: Implement in domain logic first; consider database enforcement before protected content authoring reaches production.

## Bounded JSON Payloads

- Invariant: Quiz attempt snapshots and security event metadata must stay bounded and scrubbed of secrets.
- Current migration status: JSON fields are PostgreSQL `JSONB`; no JSON schema constraints were added.
- Intended PostgreSQL concept: Application validation plus optional PostgreSQL checks on JSON shape/size if operationally necessary.
- Prisma limitation: Prisma can use PostgreSQL JSONB, but cannot define detailed payload schemas or secret scrubbing.
- Migration timing: Define application validators before write paths; add database checks only if they materially improve safety.
