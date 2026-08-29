# Tenancy And Enrollment API Foundation

This document records the implemented V1 backend foundation for tenant management, instructor onboarding, tenant-student association, and enrollment management.

## Scope

Implemented:

- Platform Admin instructor onboarding.
- Instructor tenant context reads.
- Instructor tenant-scoped student association.
- Instructor tenant-scoped enrollment creation and revocation.
- Student enrollment listing behind authentication and student-device authorization.

Not implemented:

- Course, section, lesson, video, document, or quiz authoring APIs.
- Protected content delivery.
- Student/instructor frontend or mobile UI.
- Email delivery for activation links.
- Payments, MFA, Redis, push notifications, or distributed rate limiting.

## Platform Admin Instructor Onboarding

`POST /admin/instructors` creates one instructor identity and one tenant workspace.

The backend verifies the caller is currently an `ACTIVE` `PLATFORM_ADMIN` in the database before mutation. It normalizes email using the shared authentication normalizer, rejects reuse of an existing `STUDENT` or `PLATFORM_ADMIN` identity, creates:

- `User` with `platformRole = INSTRUCTOR`
- `InstructorProfile`
- `Tenant`
- active `OWNER` `TenantMembership`
- `INSTRUCTOR_ACTIVATION` token

The raw activation token is returned only in the immediate response and is never persisted. The database stores only the activation-token hash through the authentication token service.

`GET /admin/instructors` and `GET /admin/instructors/:instructorId` are Platform Admin-only and return bounded, safe summaries.

## Instructor Tenant Access

Instructor tenant operations require:

```text
verified Bearer principal
-> current DB ACTIVE INSTRUCTOR
-> active TenantMembership for the requested tenant
-> active Tenant
```

JWT role or tenant IDs supplied by a client are not trusted as authorization by themselves.

Implemented routes:

- `GET /instructor/tenants`
- `GET /instructor/tenants/:tenantId/context`

## Student Association

Instructor student management uses `TenantStudent`, not `TenantMembership`.

`POST /instructor/tenants/:tenantId/students` is tenant-scoped and requires active instructor membership in that tenant.

New student behavior:

- create one global `User` with `platformRole = STUDENT`
- create `StudentProfile`
- create active `TenantStudent`
- issue `STUDENT_ACTIVATION` token
- do not set a password for the student
- do not authorize a device
- do not create an enrollment automatically

Existing student behavior:

- reuse the global `User`
- reuse or repair the missing `StudentProfile` if the existing STUDENT row is incomplete
- create or reactivate the `TenantStudent`
- do not alter password credentials, refresh sessions, or device state
- if the student already has a password credential, do not issue a new activation token
- reject email reuse for existing `INSTRUCTOR` or `PLATFORM_ADMIN` identities

Implemented routes:

- `POST /instructor/tenants/:tenantId/students`
- `GET /instructor/tenants/:tenantId/students`
- `GET /instructor/tenants/:tenantId/students/:studentUserId`

Student lists are paginated, bounded, and ordered deterministically. Student detail is scoped to the instructor's authorized tenant.

## Enrollment Foundation

Enrollment remains course entitlement. `TenantStudent` alone does not grant course access.

`POST /instructor/tenants/:tenantId/enrollments` verifies:

- instructor is authorized for the tenant
- target user is current DB `ACTIVE` `STUDENT`
- target student has active `TenantStudent` in the same tenant
- course belongs to the same tenant
- no cross-tenant mutation occurs

If an active enrollment for the same student/course has `endsAt <= now`, the service marks it `EXPIRED` inside the transaction before creating the replacement active enrollment. Active future/non-expired enrollments still block duplicates through service checks and the PostgreSQL partial unique index.

`POST /instructor/tenants/:tenantId/enrollments/:enrollmentId/revoke` revokes only active enrollments within the instructor's authorized tenant and preserves historical rows.

## Student Enrollment Read

`GET /student/enrollments` requires:

```text
AccessTokenGuard
-> StudentDeviceGuard
-> current DB ACTIVE STUDENT
-> own enrollments only
```

The response includes minimal enrollment/course metadata: enrollment ID, tenant ID, course ID/title/status, enrollment status, date fields, and timestamps. It does not include lesson/content/video/document data or another student's enrollment information.

## Concurrency And Integrity

The implementation relies on existing PostgreSQL uniqueness and foreign-key constraints plus transactions:

- `users.normalized_email` preserves one global identity per normalized email.
- `student_profiles.user_id` preserves one student profile per student identity.
- `tenant_students(tenant_id, student_user_id)` preserves one tenant-student association per tenant/student pair.
- `enrollments(tenant_id, student_user_id)` references `TenantStudent(tenant_id, student_user_id)`.
- The partial active-enrollment unique index preserves one active enrollment per student/course.

No new advisory locks were added for this milestone. Expected identity/enrollment races are resolved by normal unique constraints and transaction retries or stable domain errors.

## Security Events

Mutation flows record bounded security events for:

- `INSTRUCTOR_CREATED`
- `TENANT_CREATED`
- `STUDENT_ASSOCIATED_WITH_TENANT`
- `ENROLLMENT_CREATED`
- `ENROLLMENT_REVOKED`

Events contain stable IDs and state metadata only. They must not contain raw activation tokens, passwords, token hashes, refresh tokens, JWTs, or device identifiers.

## Deferred

- Instructor/student UI.
- Course/content authoring and delivery.
- Enrollment entitlement guard for protected course content.
- Student removal/reactivation endpoints.
- Activation-token delivery by email or another provider.
- Distributed rate limiting before horizontal production scaling.
