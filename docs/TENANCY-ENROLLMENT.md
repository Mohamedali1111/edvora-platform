# Tenancy And Enrollment API Foundation

This document records the implemented V1 backend foundation for tenant management, instructor onboarding, tenant-student association, and enrollment management.

## Scope

Implemented:

- Platform Admin instructor onboarding.
- Instructor tenant context reads.
- Instructor tenant-scoped student association.
- Instructor tenant-scoped enrollment creation and revocation.
- Instructor enrollment visibility: a course roster and a student's enrollment history, via one filtered, paginated read.
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

## Instructor Enrollment Visibility

`GET /instructor/tenants/:tenantId/enrollments` is the one instructor-facing enrollment read, reused for both the course-roster and student-enrollment-history screens Instructor Web needs, via query filters rather than two separate nested route families:

- `courseId` — a course roster: every Enrollment for that Course within this tenant.
- `studentUserId` — a student's enrollment history: every Enrollment for that student within this tenant, across courses.
- both together — that specific student's Enrollment(s) for that specific Course.
- `status` (optional) — narrows to one `EnrollmentStatus`.

This route already exists flat (not nested under `/courses/:courseId/` or `/students/:studentUserId/`) for `POST`/`revoke`, so a filtered `GET` on the same base path was the smaller, more consistent addition over introducing new nested route families. At least one of `courseId`/`studentUserId` is required — `ENROLLMENT_QUERY_FILTER_REQUIRED` (400) otherwise — so this stays the two concrete reads it exists for, never an unscoped "every enrollment in the tenant" read.

Authorization proves, in order: current DB `ACTIVE` `INSTRUCTOR` with active tenant membership (`assertInstructorTenantAccess`, the same check every other instructor tenancy route uses); when `courseId` is given, that the Course belongs to this exact tenant (`COURSE_NOT_FOUND` otherwise — same non-leaking behavior as `createEnrollment`); when `studentUserId` is given, that a `TenantStudent` row exists for this exact (tenant, student) pair (`TENANT_STUDENT_NOT_FOUND` otherwise — same non-leaking behavior as `GET .../students/:studentUserId`, existence-only, independent of the association's current `status`, since instructor-visible enrollment history should not disappear just because a `TenantStudent` association was later deactivated). Every filter is applied as a relational `WHERE` clause in the single list query (`tenantId` always included), never as an in-memory post-filter.

Each item is an `InstructorEnrollmentSummary`: `enrollmentId`, `tenantId`, `courseId`/`courseTitle`/`courseStatus`, `studentUserId`, `status`, `startsAt`/`endsAt`/`revokedAt`/`createdAt`, a nested `student` contact object (`studentUserId`, `email`, `displayName`, `accountStatus` — exactly the fields already exposed to instructors via `TenantStudentSummary`, never broadened), and a derived `currentlyEffective` boolean. `currentlyEffective` is computed at read time from the exact canonical Enrollment-row entitlement predicate (`status === ACTIVE && (startsAt IS NULL OR startsAt <= now) && (endsAt IS NULL OR endsAt > now)`) — deliberately narrower than full student entitlement, since it does not also require the Course to be `PUBLISHED` or the Tenant/`TenantStudent` to be `ACTIVE`; an instructor roster already has that context.

Lists persisted rows as-is by default, `REVOKED`/`EXPIRED` history included — an Enrollment row is never deleted or hidden. A student re-enrolled after revocation legitimately has multiple durable rows for the same (student, Course): the partial unique index `enrollments_one_active_per_student_course_key` only forbids two simultaneously `ACTIVE` rows for the same (student, course), never multiple historical ones, and this endpoint never collapses them.

Pagination uses the repository's bounded `limit`/`offset` contract (`PaginationQueryDto`: `limit` 1–100, default 25; `offset` ≥ 0, default 0) with deterministic `createdAt` descending, `id` ascending ordering — newest enrollment first, stable tie-break — matching every other instructor list route in this codebase. The response also includes `hasMore` (see `docs/BACKEND-DOMAIN.md`'s "API Boundary Implications" for the shared `{ items, limit, offset, hasMore }` contract and `take: limit + 1` algorithm), added additively by the API Readiness Slice.

Existing indexes (`enrollments_tenant_id_course_id_status_idx` on `(tenantId, courseId, status)`; `enrollments_student_user_id_status_idx` on `(studentUserId, status)`; `enrollments_student_user_id_course_id_status_idx` on `(studentUserId, courseId, status)`) are sufficient for V1 scale: the course-roster query is a direct prefix match on the first index, and the student-history query narrows on `studentUserId` (already a highly selective equality match, then re-checked against `tenantId`) via the second or third. No migration was needed or added.

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

## Instructor Course Progress Reporting (Backend V1 Completion)

`GET /instructor/tenants/:tenantId/courses/:courseId/progress` closes the V1 promise of instructor
progress visibility within their own tenant: one row per Enrollment for the Course, with a derived
completion count/percentage and a last-activity timestamp. Read/reporting only — no new
persistence, no BI infrastructure, no materialized aggregate. `progressPercent` is never persisted;
it is computed at read time on every request from the same `LessonProgress` truth the student-facing
read already uses.

**Denominator (`totalLessons`).** Exactly the Lessons currently visible to a student — the identical
predicate `StudentCourseAccessService` already applies for course-structure reads and manual
completion (`Lesson.status === PUBLISHED`, its Section `PUBLISHED`, and within its
`availableFrom`/`availableUntil` window as of now) — never a count of every historical Lesson row. A
DRAFT/ARCHIVED Lesson, or one under an unpublished Section, was never something any student could
complete, so it does not count against them; a not-yet-available or no-longer-available Lesson is
excluded the same way it is excluded from what a student can currently see. This denominator is
computed once per request from the Course's current Lesson set and shared by every row on that page
— it therefore moves over time as Lessons publish/unpublish or enter/leave their availability
window, a deliberate trade-off of matching live student-access semantics over a frozen historical
count.

**Numerator (`completedLessons`).** Existing `LessonProgress` truth only — a count of that
Enrollment's `COMPLETED` rows whose Lesson is in the denominator's current Lesson set, so
`completedLessons` can never exceed `totalLessons`. Never inferred from `QuizAttempt` existence,
document access, or video playback.

**Zero-denominator behavior.** When a Course currently has no visible Lessons, every row reads
`completedLessons: 0`, `totalLessons: 0`, `progressPercent: 0` — never a division by zero, `NaN`, or
`null`.

**Historical Enrollment handling.** Reuses the same policy as Instructor Enrollment Visibility
above rather than inventing a conflicting one: persisted Enrollment rows are listed as-is,
`REVOKED`/`EXPIRED` included by default, with an optional `status` filter to narrow. Each row also
carries the same `currentlyEffective` boolean (the Enrollment-row entitlement predicate only, not
full student entitlement — see Instructor Enrollment Visibility above).

**`lastActivityAt`.** The later of (a) the Enrollment's latest `LessonProgress.completedAt` across
*all* of its progress rows — not scoped to the current Lesson set, so a completion on a Lesson that
has since become unavailable/archived still counts as real past activity, even in the rare case
where `totalLessons` has since dropped to 0 — and (b) the Enrollment's latest `QuizAttempt.updatedAt`
(`QuizAttempt` rows are only ever touched at start and at submit/grade, so `updatedAt` is a real,
already-persisted "last touched" signal covering both an attempt still in progress and one already
graded). No `startedAt`/`lastAccessedAt`/watch-time field is used: those `LessonProgress` columns
exist in the schema for a future slice but nothing in this codebase writes them today, so reading
them would always yield `null`. No new tracking field was added.

**Response shape.** `enrollmentId`, `status`, `currentlyEffective`, `startsAt`/`endsAt`/`createdAt`,
a nested `student` contact object (`studentUserId`, `email`, `displayName`, `accountStatus` — the
exact same boundary already approved for Enrollment Visibility, never broadened),
`completedLessons`, `totalLessons`, `progressPercent`, `lastActivityAt`.

**Authorization / tenant safety.** `assertInstructorTenantAccess`, then a tenant-scoped Course
existence check (`COURSE_NOT_FOUND` otherwise, non-leaking). The Enrollment query's own `WHERE`
always includes `tenantId` and `courseId`; the Lesson-set query is scoped the same way. No
cross-tenant or cross-course aggregation is possible.

**Query strategy (bounded, no N+1).** Tenant authorization, one Course existence check, one query
for the Course's current Lesson-ID set, one paginated Enrollment query for the page, then — only
when the page is non-empty — one grouped `LessonProgress` count aggregate scoped to the current
Lesson set (skipped entirely when `totalLessons` is 0), one grouped `LessonProgress` max-`completedAt`
aggregate, and one grouped `QuizAttempt` max-`updatedAt` aggregate. Every aggregate is a single
`groupBy` keyed on the page's bounded `enrollmentId` list — none scale per student or per Lesson.

**Pagination/ordering.** The bounded `limit`/`offset` contract, `createdAt` descending /
`id` ascending — newest Enrollment first, stable tie-break, matching every other instructor list
route — plus `hasMore`, computed via `take: limit + 1` and trimmed to the real page *before* the
follow-up `LessonProgress`/`QuizAttempt` aggregate queries below are built from the page's
Enrollment IDs, so the sentinel row can never contribute to a returned row's `completedLessons`
or `lastActivityAt`.

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
