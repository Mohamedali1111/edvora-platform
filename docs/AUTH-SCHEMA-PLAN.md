# Authentication Schema Plan

This document describes the minimum persistence additions needed before implementing Edvora V1 authentication flows. It is a schema plan only; Prisma schema, migrations, services, controllers, and delivery integrations are not implemented yet.

## Why Add Tables

`RefreshSession` must remain dedicated to authenticated session refresh. Activation and password reset are different security workflows with different lifecycles, actors, expiry, and audit needs. Do not overload refresh sessions for one-time account activation or password reset tokens.

Use explicit purpose-specific entities for clarity and safer review:

- `AccountActivationToken`
- `PasswordResetToken`

## AccountActivationToken

Purpose: allow a newly created Instructor or Student account to set its own password through a single-use activation mechanism.

Fields:

- `id`: UUIDv7-compatible primary key.
- `userId`: required FK to `User`.
- `tokenHash`: required SHA-256 or equivalent digest of a high-entropy random token.
- `purpose`: stable enum or constrained value such as `INSTRUCTOR_ACTIVATION` or `STUDENT_ACTIVATION` if needed.
- `tenantId`: nullable FK to `Tenant` when activation was initiated from a tenant workflow.
- `courseId`: nullable FK to `Course` only if useful for invitation context; enrollment remains separate.
- `initiatedByUserId`: nullable FK to `User` for Platform Admin or Instructor actor.
- `expiresAt`: required `timestamptz`.
- `consumedAt`: nullable `timestamptz`.
- `revokedAt`: nullable `timestamptz`.
- `createdAt`: required `timestamptz`.

Constraints and indexes:

- Unique `tokenHash`.
- Index `(userId, consumedAt, expiresAt)` for finding pending activation state.
- Index `(tenantId, createdAt)` for tenant/admin review if needed.
- Optional partial unique index to allow at most one unconsumed, unrevoked activation token per user if product workflow requires it.

Lifecycle:

- Raw token is shown only once to the authorized workflow after generation.
- Store only the hash.
- Token expires after a short operational window, initially 7 days unless product/support needs a shorter value.
- Consuming the token sets `consumedAt` and creates/updates the password credential in one transaction.
- Revocation invalidates outstanding activation links without deleting audit history.
- Retain consumed/expired token rows for limited security audit, then purge according to retention policy.

## PasswordResetToken

Purpose: allow a user to recover account access without Platform Admin, Instructor, or support staff learning or setting the user's password.

Fields:

- `id`: UUIDv7-compatible primary key.
- `userId`: required FK to `User`.
- `tokenHash`: required SHA-256 or equivalent digest of a high-entropy random token.
- `initiatedByUserId`: nullable FK to `User` for Platform Admin/support-initiated reset workflows.
- `expiresAt`: required `timestamptz`.
- `consumedAt`: nullable `timestamptz`.
- `revokedAt`: nullable `timestamptz`.
- `createdAt`: required `timestamptz`.

Constraints and indexes:

- Unique `tokenHash`.
- Index `(userId, consumedAt, expiresAt)` for active reset lookup.
- Index `(createdAt)` for retention cleanup.
- Optional partial unique index to allow at most one unconsumed, unrevoked reset token per user if support workflow requires it.

Lifecycle:

- Raw token is shown/sent only once.
- Store only the hash.
- Token expires quickly, initially 30 to 60 minutes.
- Request response must be generic and must not reveal whether an account exists.
- Consuming the token, updating the password hash, revoking refresh sessions, and recording a security event must happen in one transaction.
- Retain consumed/expired token rows for limited security audit, then purge according to retention policy.

## Migration Considerations

- Use PostgreSQL `uuid` IDs without database defaults, consistent with the current UUIDv7 application-generation decision.
- Use `timestamptz` for all timestamps.
- Use `Restrict` or `SetNull` intentionally; do not cascade-delete security evidence blindly.
- Add partial indexes/check constraints only in reviewed SQL migrations if Prisma cannot express them accurately.
- Do not add email-provider fields until a provider/delivery workflow is selected.

## Deferred

- Email delivery provider.
- Public self-registration verification tokens.
- MFA recovery tokens.
- Token cleanup jobs/queues.
- Redis/distributed abuse throttling.
