# Tenancy And Enrollment API Foundation

This document records the implemented V1 backend foundation for tenant management, instructor onboarding, tenant-student association, and enrollment management.

## Scope

Implemented:

- Platform Admin instructor onboarding.
- Instructor tenant context reads.
- Instructor tenant-scoped student association.
- Instructor tenant-scoped enrollment creation and revocation.
- Student enrollment listing behind authentication and student-device authorization.
- Student course entitlement and read access (own entitled course list, entitled course structure) behind authentication, student-device authorization, and the full course-content entitlement chain. Course, section, and lesson *authoring* APIs are documented separately (see `docs/STATUS.md`'s Course Slice A/B entries).
- Minimal student lesson progress: reading own progress alongside course structure, and marking an accessible non-quiz lesson completed.

Not implemented:

- Video, document, or quiz authoring/upload APIs.
- Protected content delivery is implemented for student quiz content/attempts, document download
  capability issuance, and Bunny video playback capability issuance; further player/frontend
  integration remains deferred.
- Video watch-time/resume-position tracking, quiz-derived progress, and persisted aggregate course-percentage fields.
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

## Student Course Entitlement (Course Milestone Slice C)

`GET /student/courses` and `GET /student/courses/:courseId` are the first endpoints that authorize access to course *content*, not just enrollment records. Both require:

```text
AccessTokenGuard
-> StudentDeviceGuard
-> current DB ACTIVE STUDENT
-> currently entitled ACTIVE Enrollment (status, and startsAt/endsAt evaluated against ClockService.now())
-> ACTIVE TenantStudent for the course's own tenant
-> Course PUBLISHED in an ACTIVE tenant
-> (detail only) ordered PUBLISHED Sections/Lessons belonging to that Course, each Lesson additionally filtered by its own availableFrom/availableUntil window
```

Implemented by one focused, reusable `StudentCourseAccessService` (`apps/api/src/modules/courses/services/student-course-access.service.ts`) rather than scattering these checks across controllers. Key contract points:

- **The tenant is never client-supplied.** Both routes take only `courseId` — no `tenantId` path segment exists. The tenant is always derived from the course/enrollment relationship itself, consistent with a student being associated with more than one tenant over time.
- **A database row may remain `ACTIVE` after `endsAt`.** The entitlement check evaluates `status === ACTIVE AND (startsAt IS NULL OR startsAt <= now) AND (endsAt IS NULL OR endsAt > now)` on every read; it never treats a stale-but-still-`ACTIVE` row as entitled, and it never mutates/expires that row as a side effect of a read. Expiring stale rows remains an instructor-mutation-time concern (see `createEnrollment` above), not a read-time one.
- **`Course.status` must be `PUBLISHED`.** A valid Enrollment never makes a `DRAFT` or `ARCHIVED` course accessible. `CourseVisibility` (`PRIVATE`/`ENROLLED_ONLY`) carries no additional access-control meaning in V1 — Enrollment remains required for all student course access regardless of its value.
- **No existence leakage.** Every rejection reason — course does not exist, belongs to a tenant the student has no association with, is not `PUBLISHED`, has no entitled Enrollment, or the Enrollment's time window does not currently cover `now` — throws the same `CourseNotFoundError` (404). A cross-tenant or otherwise-foreign course ID is indistinguishable from a nonexistent one.
- **Nested ownership is proved by construction.** The course detail response is built from one `course.findUnique` nested `include` scoped to the already-authorized `courseId`; a section or lesson belonging to a different course can never appear in it, by Prisma relational traversal, not by an application-level filter that could be gotten wrong.
- **Unavailable lessons are omitted, not exposed as locked metadata.** A lesson outside its `availableFrom`/`availableUntil` window (or not `PUBLISHED`) is simply absent from the response — this is the conservative choice where neither `docs/PRODUCT.md` nor `docs/BACKEND-DOMAIN.md` specify one, since omission leaks no title, type, or existence of content the student cannot yet reach, whereas a "locked" placeholder would.
- **Responses are student-safe by construction.** New `Student*` response types (distinct from the instructor-facing `CourseSummary`/`CourseSectionSummary`/`LessonSummary` family) never include ownership/authoring fields, and for typed lessons expose only: VIDEO — processing status and duration; DOCUMENT — file name, MIME type, size; QUIZ — title and status. Provider keys, external asset references, internal asset/quiz IDs, playback/download URLs, and quiz questions/options/answers are never included. Protected playback authorization, document access, and quiz execution remain separate, later endpoints.

## Minimal Lesson Progress (Course Milestone Slice D)

Built directly on the Slice C entitlement chain — no new controller-level authorization logic. `StudentCourseAccessService` gained two capabilities:

- **Read**: `GET /student/courses/:courseId` now includes each lesson's `progress: { status, completedAt }`. This is one additional query scoped to `(studentUserId, enrollmentId)` alongside the existing course-structure query (never per-lesson), with results mapped onto lessons by ID in memory. A lesson with no `LessonProgress` row reads as `NOT_STARTED` with `completedAt: null` — a row is never created merely to serve a read.
- **Write**: `POST /student/courses/:courseId/lessons/:lessonId/complete` marks a VIDEO or DOCUMENT lesson completed. It reuses the same entitlement proof as the read side, then re-applies the identical published-section/published-lesson/availability-window predicate the structure query uses before allowing completion — a lesson that would not currently appear in the student's course structure cannot be completed either, and the failure (wrong course/tenant, DRAFT/ARCHIVED, outside its availability window) is the same `LessonNotFoundError` used elsewhere, so nothing new leaks existence. QUIZ lessons are explicitly rejected (`QuizLessonCompletionNotAllowedError`, 400) — quiz completion belongs to the future quiz-execution domain.
- **Ownership**: `studentUserId` is always `principal.userId` and `enrollmentId` is always the value the same entitlement check just resolved — neither is ever accepted as a request input, so there is no way to reference or mutate another student's `LessonProgress` row.
- **Idempotency**: completion attempts a `create` first (the common case). On the `(studentUserId, lessonId, enrollmentId)` unique-constraint conflict, it falls back to an `updateMany` guarded by `status: { not: COMPLETED }` — this is what makes a stale NOT_STARTED/STARTED row transition exactly once, an already-COMPLETED row return unchanged without re-stamping `completedAt`, and any number of concurrent duplicate requests converge to exactly one row, all without an explicit lock.
- **Deliberately not implemented**: video watch-time/resume-position writes, quiz-derived completion, and persisted aggregate course-percentage fields — all explicitly out of this milestone's scope.

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
- Video watch-time/resume-position tracking, quiz-derived completion, and persisted aggregate course-percentage fields.
- Protected video playback authorization, document access, and quiz authoring/execution.
- Uploads/provider integration for video and document assets.
- Student removal/reactivation endpoints.
- Activation-token delivery by email or another provider.
- Distributed rate limiting before horizontal production scaling.
