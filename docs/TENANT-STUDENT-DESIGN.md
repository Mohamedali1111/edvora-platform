# Tenant Student Association Design

This document finalizes the missing tenant-to-student persistence design required before implementing tenant, instructor student-management, and enrollment APIs.

## Decision

Add a separate `TenantStudent` model.

Do not add `STUDENT` to `TenantMembershipRole`. `TenantMembership` remains for tenant operators and staff: `OWNER`, `INSTRUCTOR`, and `STAFF`. Students are learners associated with a tenant, not operators inside the tenant workspace.

`TenantStudent` means:

```text
A global Edvora STUDENT identity is associated with a specific Tenant/academy.
```

It does not itself grant course access. Course entitlement remains `Enrollment`.

## Name Choice

Chosen name: `TenantStudent`.

Alternatives considered:

- `StudentTenantAssociation`: accurate but verbose for a central domain model.
- `TenantStudentMembership`: clearer than generic membership, but still risks confusion with staff/operator `TenantMembership`.
- `TenantStudent`: concise, conventional, and reads naturally in code such as `tenant.tenantStudents` and `user.tenantStudentAssociations`.

## Model Semantics

The four concepts stay separate:

- `User`: global identity with email, account status, and platform role.
- `StudentProfile`: global student profile attached one-to-one to the global student identity.
- `TenantStudent`: tenant-scoped learner association between a global student and one tenant.
- `Enrollment`: course entitlement for a student within a tenant/course.

Relationship shape:

```text
User (global STUDENT)
      |
      +-- TenantStudent -- Tenant A
      |
      +-- TenantStudent -- Tenant B

Each TenantStudent relationship
      |
      +-- zero or more Enrollment records
```

A student can exist globally once, use one password and global device authorization state, belong to multiple tenants, and have different enrollments under each tenant.

## Fields

Minimal fields:

- `id`: UUID primary key.
- `tenantId`: target tenant.
- `studentUserId`: global `User` with platform role `STUDENT`.
- `status`: lifecycle state.
- `createdByUserId`: nullable initiating actor for audit/support context.
- `activatedAt`: nullable timestamp for when the association became active.
- `removedAt`: nullable timestamp for later tenant removal.
- `createdAt`, `updatedAt`.

Status is justified because removing a student from a tenant must preserve historical enrollments/progress and allow safe re-association without deleting relationship history. Account suspension/deletion remains a separate `User.accountStatus` concern.

Recommended enum:

```prisma
enum TenantStudentStatus {
  ACTIVE
  INACTIVE
  REMOVED

  @@map("tenant_student_status")
}
```

Semantics:

- `ACTIVE`: student is currently associated with the tenant and can be considered for enrollment/entitlement checks.
- `INACTIVE`: association is paused without deleting history.
- `REMOVED`: student was removed from the tenant; historical enrollments/progress remain retained according to policy.

Invitation and password activation are not encoded in `TenantStudentStatus`. Identity activation remains represented by `AccountActivationToken` and credential presence.

## Proposed Prisma Design

This schema shape is implemented in `apps/api/prisma/schema.prisma` through the reviewed additive migration `20260823020000_add_tenant_student_associations`.

```prisma
enum TenantStudentStatus {
  ACTIVE
  INACTIVE
  REMOVED

  @@map("tenant_student_status")
}

model User {
  // existing fields...
  tenantStudentAssociations TenantStudent[] @relation("TenantStudentUser")
  createdTenantStudents     TenantStudent[] @relation("TenantStudentCreator")
}

model Tenant {
  // existing fields...
  tenantStudents TenantStudent[]
}

model TenantStudent {
  id              String              @id @db.Uuid
  tenantId        String              @map("tenant_id") @db.Uuid
  studentUserId   String              @map("student_user_id") @db.Uuid
  status          TenantStudentStatus @default(ACTIVE)
  createdByUserId String?             @map("created_by_user_id") @db.Uuid
  activatedAt     DateTime?           @map("activated_at") @db.Timestamptz(6)
  removedAt       DateTime?           @map("removed_at") @db.Timestamptz(6)
  createdAt       DateTime            @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt       DateTime            @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant    Tenant @relation(fields: [tenantId], references: [id], onDelete: Restrict)
  student   User   @relation("TenantStudentUser", fields: [studentUserId], references: [id], onDelete: Restrict)
  createdBy User?  @relation("TenantStudentCreator", fields: [createdByUserId], references: [id], onDelete: SetNull)

  @@unique([tenantId, studentUserId], map: "tenant_students_tenant_id_student_user_id_key")
  @@index([studentUserId, status], map: "tenant_students_student_user_id_status_idx")
  @@index([tenantId, status, createdAt], map: "tenant_students_tenant_id_status_created_at_idx")
  @@index([createdByUserId, createdAt], map: "tenant_students_created_by_user_id_created_at_idx")
  @@map("tenant_students")
}
```

Application logic must verify `student.platformRole === STUDENT`; PostgreSQL cannot express that cross-table role check as a simple foreign key.

## Enrollment Relationship Decision

Choose Option A with a composite foreign key:

Keep `Enrollment` fields as `tenantId`, `studentUserId`, and `courseId`; add a database relationship from `Enrollment(tenantId, studentUserId)` to `TenantStudent(tenantId, studentUserId)`.

Do not add `tenantStudentId` to `Enrollment` initially.

Reasoning:

- Avoids redundant surrogate relationship data while `Enrollment` already carries tenant and student IDs needed by access queries.
- Preserves current composite tenant/course integrity on `Enrollment(courseId, tenantId) -> Course(id, tenantId)`.
- Provides DB-level proof that an enrollment cannot be created unless the student is associated with that tenant.
- Keeps query patterns simple for student enrollment lists and instructor tenant-scoped enrollment management.
- Avoids another ID that must be kept consistent with `tenantId` and `studentUserId`.

Implemented `Enrollment` Prisma relation shape:

```prisma
model TenantStudent {
  // existing fields...
  enrollments Enrollment[]

  @@unique([tenantId, studentUserId], map: "tenant_students_tenant_id_student_user_id_key")
}

model Enrollment {
  // existing fields...
  tenantStudent TenantStudent @relation(fields: [tenantId, studentUserId], references: [tenantId, studentUserId], onDelete: Restrict)
}
```

`Enrollment` should continue to enforce course tenant integrity through `courseId + tenantId`.

## Database Integrity Plan

Implemented PostgreSQL constraints and indexes:

- Primary key: `tenant_students_pkey` on `id`.
- Unique key: `tenant_students_tenant_id_student_user_id_key` on `(tenant_id, student_user_id)`.
- Foreign key: `tenant_students.tenant_id -> tenants.id ON DELETE RESTRICT ON UPDATE CASCADE`.
- Foreign key: `tenant_students.student_user_id -> users.id ON DELETE RESTRICT ON UPDATE CASCADE`.
- Foreign key: `tenant_students.created_by_user_id -> users.id ON DELETE SET NULL ON UPDATE CASCADE`.
- Composite foreign key: `enrollments(tenant_id, student_user_id) -> tenant_students(tenant_id, student_user_id) ON DELETE RESTRICT ON UPDATE CASCADE`.
- Index: `tenant_students_student_user_id_status_idx` for student-side tenant association and entitlement checks.
- Index: `tenant_students_tenant_id_status_created_at_idx` for instructor tenant student lists.
- Index: `tenant_students_created_by_user_id_created_at_idx` for support/audit lookup by creator.

No time-dependent partial indexes are needed.

Stable timestamp checks are implemented in the PostgreSQL migration:

- `activated_at IS NULL OR activated_at >= created_at`
- `removed_at IS NULL OR removed_at >= created_at`

Lifecycle policy remains application-enforced: for example, `REMOVED` rows should have `removedAt`, and entitlement checks should require `TenantStudent.status = ACTIVE`.

## Invitation Behavior

New student:

```text
Instructor adds email
-> User created with platformRole STUDENT
-> StudentProfile created
-> TenantStudent created for the instructor's tenant
-> STUDENT_ACTIVATION token created
```

No password is chosen by the instructor. No device is authorized. No enrollment is created unless a separate enrollment use case is invoked.

Existing global student:

```text
Instructor adds existing global STUDENT
-> reuse User
-> reuse StudentProfile
-> create or reactivate TenantStudent only
-> do not alter password
-> do not alter device
```

If the existing student already has credentials or has completed activation, do not issue a new activation token just because a second tenant associated the student.

Existing unactivated student:

- Keep one coherent global credential activation flow.
- If a safe outstanding `STUDENT_ACTIVATION` token exists, reuse the fact of pending activation but do not expose an old raw token again because raw tokens are only returned once.
- If the workflow needs a deliverable activation link for the newly associating tenant, revoke older outstanding `STUDENT_ACTIVATION` tokens transactionally and issue one new global activation token tied to the latest authorized tenant context.
- The tenant association does not own credentials and must not create tenant-specific passwords.

Cross-role email conflict:

- Existing `INSTRUCTOR` or `PLATFORM_ADMIN` identities must not be silently converted to students.
- Future multi-role users require a separate reviewed decision.

## Removal And Retention

Removing a student from a tenant should update `TenantStudent.status` to `REMOVED` and set `removedAt`.

Removal must not:

- Delete the global `User`.
- Delete `StudentProfile`.
- Delete another tenant's `TenantStudent` row.
- Change password credentials.
- Revoke sessions by itself.
- Approve, revoke, or replace student devices.
- Delete historical enrollments, progress, or quiz attempts.

Future enrollment entitlement checks should require both an active association and a valid active enrollment. Historical records remain linked for instructor operations, support, and retention policy.

## Authorization Consequences

Future instructor student management:

```text
authenticated INSTRUCTOR
-> current DB role/status
-> ACTIVE TenantMembership in tenant
-> target student has TenantStudent association in same tenant
```

Future student entitlement:

```text
authenticated STUDENT
-> approved device
-> ACTIVE TenantStudent relationship
-> valid Enrollment
-> Course belongs to same tenant
```

`GET /instructor/students` should query `TenantStudent`, not `Enrollment`, so an instructor can see students before course enrollment and students with zero, multiple, expired, or revoked enrollments without conflating association with entitlement.

## Concurrency Invariants

Same tenant and same new email:

- Exactly one `User`.
- Exactly one `StudentProfile`.
- Exactly one `TenantStudent`.
- At most one deliverable activation token according to token issuance policy.

Different tenants and same new email:

- Exactly one global `User`.
- Exactly one `StudentProfile`.
- One `TenantStudent` per tenant.
- Activation remains global and coherent.

Existing student:

- Concurrent same-tenant association creates or reactivates one relationship only.
- Concurrent different-tenant association creates separate tenant relationships without duplicating identity or credentials.

These invariants rely on `users.normalized_email`, `student_profiles.user_id`, and `tenant_students(tenant_id, student_user_id)` uniqueness plus transactional application logic.

## Security Events

Planned event types:

- `STUDENT_ASSOCIATED_WITH_TENANT`
- `STUDENT_REMOVED_FROM_TENANT`

Events should store safe stable IDs such as tenant ID, target user ID, actor user ID, and association ID. They must not store passwords, activation raw tokens, token hashes, refresh tokens, device identifiers, or credential material.

## Migration Impact

The schema change is implemented as a new additive migration after the existing approved migrations.

Migration work:

- Create `tenant_student_status` enum.
- Create `tenant_students` table.
- Add foreign keys to `tenants` and `users`.
- Add unique/indexes listed above.
- Add composite foreign key from `enrollments(tenant_id, student_user_id)` to `tenant_students(tenant_id, student_user_id)`.
- Add stable timestamp CHECK constraints.

Because current development databases should not contain production data, backfill complexity is low. Still, if any existing enrollment rows exist in a disposable or future shared environment, adding the composite foreign key requires a matching `TenantStudent` row for every existing `(tenant_id, student_user_id)` enrollment pair before the constraint can be validated.

Do not edit approved existing migrations.

## Current Implementation Status

Persistence is implemented in Prisma schema and the reviewed PostgreSQL migration.

Prompt #14 tenant/instructor/student/enrollment service implementation remains pending until this persistence change is reviewed and committed. No tenancy/enrollment service code exists yet.
