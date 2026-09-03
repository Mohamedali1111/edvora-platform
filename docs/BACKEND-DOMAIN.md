# Backend Domain Model

This document defines the V1 backend domain model for Edvora before Prisma, PostgreSQL, controllers, services, or product modules are introduced. It is a design source of truth, not an implementation.

## Domain Overview

Edvora is a multi-tenant, security-first EdTech SaaS platform. Instructors operate tenant-scoped teaching workspaces. Students use a shared Edvora identity and may study with more than one tenant over time. Platform Admin users operate the platform across tenants and own security-sensitive actions such as student device-change approvals.

Core V1 backend domains:

- Identity and authentication credentials
- Users and role/capability boundaries
- Tenants and tenant memberships
- Student and instructor profiles
- Student devices and device-change requests
- Courses, sections, and ordered lesson content
- Video/document metadata
- Quizzes, questions, attempts, and answers
- Enrollments/course access
- Learning progress
- Basic notifications
- Security events and audit trail
- Account status and deletion lifecycle

## Ownership Boundaries

Tenant-owned resources include courses, sections, lessons, videos, documents, quizzes, enrollments, tenant-scoped notifications, and instructor-facing student/course management records.

Platform-owned resources include canonical user identity, platform roles, authentication credentials, platform-wide security events, device-change approval workflow, and Platform Admin operations.

The backend must never rely on a client-supplied `tenantId` alone. Tenant access must be resolved from authenticated identity, tenant membership, resource ownership, and the action being attempted.

## Tenant Model

V1 tenant decision: a tenant represents an instructor-owned teaching workspace or academy boundary.

A tenant may initially contain one instructor, but users relate to tenants through `TenantMembership` rather than a single `tenantId` on `User`. This keeps the model simple while allowing:

- More than one instructor/staff user in a tenant later.
- One student to study with more than one instructor/tenant over time.
- Platform Admin users to remain platform-wide rather than ordinary tenant members.

`TenantMembership` represents operator/staff role and status within a tenant. It supports tenant roles such as `OWNER`, `INSTRUCTOR`, and later `STAFF`; it must not be expanded with a `STUDENT` role. Students are learners rather than tenant operators.

Tenant-associated students are represented through a separate `TenantStudent` relationship between a global `STUDENT` user and a tenant. `TenantStudent` records association with an academy/tenant, while `Enrollment` remains the course-access source of truth. See `docs/TENANT-STUDENT-DESIGN.md`.

## Canonical User / Identity Model

Edvora should use one canonical `User` entity for all people. Do not create unrelated identity tables for Students, Instructors, and Platform Admins.

`User` owns identity-level fields:

- Stable ID.
- Email and normalized email.
- Account status.
- Preferred language.
- Platform role/capability flags.
- Timestamps.
- Deletion/anonymization lifecycle fields.

Authentication credential material belongs to the server-side authentication layer. Password hashes, password reset state, refresh/session state, and future credential factors should not be scattered into student/instructor/admin profile records. Plaintext passwords must never be stored.

Profiles are separate:

- `StudentProfile` stores student-specific profile fields.
- `InstructorProfile` stores instructor-specific profile fields.

Profiles are optional one-to-one extensions of `User`. A user may have more than one profile type if the product later allows mixed usage, but authorization should still be driven by platform role, tenant membership, and resource access rather than profile existence alone.

## Role and Authorization Model

Authorization has three layers:

1. Platform-level role/capability: `STUDENT`, `INSTRUCTOR`, `PLATFORM_ADMIN`.
2. Tenant membership role/status: tenant-scoped role such as `OWNER` or `INSTRUCTOR`.
3. Resource access: enrollment, course ownership, lesson availability, quiz attempt permissions, device authorization, and security workflow permissions.

`PLATFORM_ADMIN` is platform-wide. Platform Admin can operate across tenants through explicit admin authorization paths and approve/reject device-change requests.

`INSTRUCTOR` is not automatically platform-wide. Instructor access must be limited to tenants where the user has an active instructor/owner membership.

`STUDENT` is not equivalent to course access. A student must authenticate, use an authorized device where required, and have an active enrollment for the course/content being accessed.

Server-side authorization must derive permissions from the authenticated identity and database-backed relationships. Do not trust client-provided role claims, tenant IDs, enrollment IDs, or device claims without verification.

## Key Invariants

- One canonical `User` identity per person/account.
- `normalizedEmail` is unique among active/non-deleted user identities.
- A tenant-scoped resource belongs to exactly one tenant.
- A tenant operator may have only one active membership row per tenant.
- A student can be associated with multiple tenants through `TenantStudent` without duplicating global identity or credentials.
- A student can have active enrollments in multiple tenants, but enrollment must not replace tenant-student association.
- V1 defaults to one approved active device per student, but device limits are policy/configurable.
- A new device never silently replaces an approved active device.
- Instructors cannot approve or reset student devices in V1.
- Secure content access requires authentication, tenant/resource authorization, enrollment, device authorization where applicable, and content availability.
- Quiz attempts remain interpretable after quiz edits.
- Progress updates should be idempotent and retry-safe.
- Security/audit events must not contain secrets or raw tokens.

## Student Device Lifecycle

Device binding is security-critical and must be enforced server-side.

Recommended lifecycle:

1. First login from a student device sends a client-generated installation/device identifier and platform/app metadata.
2. The server checks device policy for the student. With no existing approved active device, the first device may be registered and approved according to V1 policy.
3. Approved devices can be used for protected student content access.
4. Login from a different device does not replace the active device. The backend records an unauthorized/new-device attempt and can create or expose a device-change request flow.
5. The student submits a `DeviceChangeRequest`.
6. A `PLATFORM_ADMIN` approves or rejects the request.
7. Approval happens in a transaction: revoke/deactivate the previous device if required by policy, activate the requested device, close competing pending requests, and record security events.
8. Rejection keeps the current active device unchanged.

A client-generated device identifier is not permanently trustworthy and is not invasive hardware fingerprinting. It is one signal within a server-controlled authorization model. Future native device trust, root/jailbreak signals, attestation, or secure storage can be added without changing the ownership model.

## Course Content Model

Use a generic `Lesson` record inside a `Section`, with type-specific one-to-one detail records:

- `VideoLesson`
- `DocumentLesson`
- `QuizLesson`

This is preferable to direct polymorphic section content because ordering is simple and consistent, shared lesson lifecycle fields live in one place, type-specific metadata remains normalized, PostgreSQL/Prisma can model explicit relations cleanly, and future content types can be added without redesigning section ordering.

Course hierarchy:

```text
Tenant
-> Course
-> Section
-> Lesson
   -> VideoLesson | DocumentLesson | QuizLesson
```

V1 courses should support title, optional description, thumbnail/media reference, lifecycle/status, publication visibility, timestamps, and ordered sections/lessons. Do not add pricing, checkout, marketplace, or store fields.

Course authoring lifecycle transitions are explicit application-service actions, not generic client
metadata writes. `Course`, `CourseSection`, `Lesson`, and `Quiz` support `DRAFT -> PUBLISHED`,
`DRAFT -> ARCHIVED`, `PUBLISHED -> ARCHIVED`, the reversible explicit take-offline transition
`PUBLISHED -> DRAFT`, and explicit restore `ARCHIVED -> DRAFT`; publishing an already-published
resource, unpublishing/restoring an already-draft resource, and archiving an already-archived
resource are idempotent. Restore never makes content Live, never infers a prior state, and existing
publish endpoints are the only path from restored Draft content back to Live.
Publishing never cascades to descendants or ancestors: each Course, Section, Lesson, and Quiz must
be published explicitly. Take Offline/unpublish and Restore likewise never cascade and preserve
historical student data, enrollments, progress, attempts, answers, ordering, content references, and
existing `publishedAt` timestamps on Course and Quiz. Archiving likewise does not cascade; ancestor
status already blocks student access while preserving descendant state and historical ordering. For
Quiz authoring specifically, an `ARCHIVED` parent Quiz rejects ordinary Question and Option
mutations, including create, metadata/correctness update, and reorder, until the Quiz itself is
explicitly restored. Question restore, media restore, and student lifecycle restore are not
implemented by this content restore boundary.

Course and Section publication has no V1 child-count prerequisite. Lesson publication additionally
requires deliverable type-specific content: VIDEO and DOCUMENT lessons must reference tenant-linked
`READY` assets, and QUIZ lessons must reference a tenant-linked `PUBLISHED` Quiz. Quiz publication
validates the current active aggregate: at least one `ACTIVE` question, positive points, valid
options, and exactly one correct option for each active question; archived questions are ignored,
matching student delivery and attempt snapshot behavior.

A `PUBLISHED` Quiz stays editable, but the same aggregate rule `publishQuiz()` enforces is
re-checked, in the same database transaction, after every Question/Option authoring mutation that
can affect it (Question create/update, Option create/update); a mutation that would leave the
Quiz's active aggregate unpublishable is rejected atomically and the prior valid state is
unchanged. A `DRAFT` Quiz is exempt from this check and may stay incomplete indefinitely while an
instructor builds it — the aggregate rule is enforced only at the DRAFT → PUBLISHED transition and
on every subsequent mutation while already `PUBLISHED`, never continuously against a DRAFT Quiz.
Creating a new Question is rejected outright while its Quiz is `PUBLISHED`: this authoring API
creates a Question first and its Options only through later, separate calls, so a brand-new
Question always starts with zero Options and can never itself satisfy "exactly one correct
option" — rather than allow that incomplete state to land, even transiently, Question creation on
a `PUBLISHED` Quiz fails with the same publishability error `publishQuiz()` would produce. This
mutation-safety check, `publishQuiz()`, `unpublishQuiz()`, `restoreQuiz()`, and `archiveQuiz()` share one PostgreSQL
transaction-scoped advisory lock keyed on the Quiz ID, so lifecycle boundary changes and concurrent
publishability-affecting mutations on the same Quiz always serialize rather than both observing a
stale pre-commit status; Option mutations additionally keep their existing Question-scoped advisory
lock for the option-count/correctness invariants, always acquired after the Quiz-level lock, never
before, to keep lock ordering consistent and deadlock-free. Quiz archive and ordinary Question/Option
authoring mutations share the Quiz-level advisory lock, so a child mutation may complete before an
archive, but cannot observe a mutable parent and then commit after the Quiz has become `ARCHIVED`.
Setting `QuestionOption.isCorrect` to `true` through the existing Option update route atomically
selects that Option as the sole correct Option for its Question by clearing sibling correctness in
the same transaction before re-validating any already-`PUBLISHED` Quiz aggregate.

## Course Readiness Derivation

`GET /instructor/tenants/:tenantId/courses/:courseId/readiness` is the single authoritative,
server-side source of truth for "what in this Course could be published right now" — it replaces an
earlier Instructor Web client-side derivation that resolved Lesson content state against one
paginated page of the tenant's Media list (`MEDIA_PAGE_SIZE = 20`) and silently treated any
referenced asset outside that page as unknown/not-ready. The endpoint instead reads only the exact
Section/Lesson/VideoAsset/DocumentAsset/Quiz records this Course's own Lesson relations reference —
one bounded, nested Prisma read scaled to the Course's own structure, never a tenant-wide list — so
correctness no longer depends on how many other media assets or quizzes the tenant happens to have.

The response is a machine-readable readiness fact sheet, never translated/localized product copy:
stable `reasonCode`s (`VIDEO_PREPARING`/`VIDEO_FAILED`/`VIDEO_ASSET_ARCHIVED`,
`DOCUMENT_PREPARING`/`DOCUMENT_FAILED`/`DOCUMENT_ASSET_ARCHIVED`, `QUIZ_ARCHIVED`, the three
`QUIZ_NOT_PUBLISHABLE_*` codes, and the advisory-only `SECTION_EMPTY`/
`LESSON_AVAILABILITY_WINDOW_ELAPSED`) plus each entity's own raw authored title, which the Instructor
Web maps to localized UI copy. There is deliberately no "Section/Lesson is DRAFT" reason code — see
below. `VIDEO_ASSET_ARCHIVED`/`DOCUMENT_ASSET_ARCHIVED` are represented through the existing
`AssetProcessingStatus.ARCHIVED` enum value already in the schema — no new media field or migration
was added; no application code currently transitions an asset into that state, but the readiness
endpoint honors it structurally regardless, ahead of the still-unimplemented Media Library archive
lifecycle.

**Lifecycle state and content readiness are different concepts.** `readyToPublish` exists to feed the
future `POST .../courses/:courseId/publish-selected`, which lets an instructor explicitly select which
currently-`DRAFT` Sections/Lessons should transition to `PUBLISHED`. A `DRAFT` Section/Lesson is
therefore the *expected, normal* state of a first-publish candidate, never a blocker by itself: a
brand-new Course (`Course DRAFT -> Section DRAFT -> Lesson DRAFT -> VideoAsset READY`) must be a valid
candidate without the instructor first manually publishing the Section and Lesson one click at a time —
that would recreate exactly the multi-click authoring workflow this endpoint exists to remove.
Candidacy rules:

- **Lesson**: `status === DRAFT` AND belongs to a non-`ARCHIVED` Section AND its referenced content is
  "content-ready" (below). An already-`PUBLISHED` Lesson is never a candidate — it is already live and
  needs no transition — regardless of its parent Section's status (a `DRAFT`, ready Lesson under an
  already-`PUBLISHED` Section is still a valid candidate needing only itself selected, matching the
  future publish-selected contract's "a selected Lesson's Section must either be included in selected
  sectionIds OR already be PUBLISHED" rule).
- **Section**: `status === DRAFT` AND it contains at least one candidate Lesson. An already-`PUBLISHED`
  Section is never a candidate (nothing to transition); an empty or all-unready-Lesson `DRAFT` Section
  is also never a candidate — Section publication has no child-count prerequisite in the real backend,
  but offering an empty/unready Section for first-publish selection would deliver no actual
  student-consumable content, so it is excluded here (surfaced instead as the `SECTION_EMPTY`
  advisory).
- **Quiz**: listed in `readyToPublish.quizzes` only for a candidate QUIZ Lesson whose Quiz is still
  `DRAFT` — i.e. exactly the Quiz publish-selected will need to transition to `PUBLISHED` as a
  server-side side effect of publishing its Lesson. An already-`PUBLISHED` Quiz backing a candidate
  Lesson needs no such transition and is not listed.

Content-issue blockers (`VIDEO_PREPARING`/`VIDEO_FAILED`/..., `QUIZ_NOT_PUBLISHABLE_*`, `QUIZ_ARCHIVED`)
are evaluated for every non-`ARCHIVED` Lesson regardless of its own `DRAFT`/`PUBLISHED` status — useful
diagnostics for already-published Course content too (e.g. a previously-`READY` video that later moved
to `FAILED`), without ever gating an already-`PUBLISHED` Lesson's candidacy, since it was never a
candidate to begin with.

V1 supports progressive Course authoring, so `ready` is deliberately **not** "every descendant in the
Course is ready" — a Course may legitimately carry unfinished, future Draft content indefinitely, and
`ready` is true iff `readyToPublish.lessons` is non-empty, i.e. at least one Lesson currently has actual,
student-consumable content that could be published right now. An empty or content-less Section can
never make `ready` true by itself — the product needs actual publishable content, not merely a
technically legal empty Section, to justify "ready to publish." `blockers` still lists every
unfinished or broken piece elsewhere in the Course so the UI can explain it; that never by itself flips
`ready` to false as long as some valid Lesson candidate exists.

QUIZ Lesson content-readiness reuses the exact same Quiz-aggregate publishability rule
`QuizService.publishQuiz()` enforces (`evaluateQuizPublishability`, extracted as a pure evaluator so
existing throw-based `assertQuizPublishable()` call sites are unchanged) — but, deliberately, evaluated
against the Quiz's *current* aggregate regardless of whether the Quiz itself is already `PUBLISHED` or
still `DRAFT`. An aggregate-valid `DRAFT` Quiz is content-ready for readiness purposes, because
readiness describes what *could* be published as part of this Course's future publish flow, not only
what has already been explicitly published on its own. This is intentionally broader than the
standalone `POST /lessons/:id/publish` gate, which still requires the referenced Quiz to already be
`PUBLISHED` (`LessonService`'s existing content-readiness check is unchanged).

`readyToPublish` (`sections`/`lessons`/`quizzes`) is the informational candidate set the planned
`FIRST_PUBLISH` review screen will let an instructor explicitly select from. It is read-only,
informational data: the future publish-selected endpoint will never trust a client-supplied quizId (or
any other ID) from this response and will re-resolve every reference from the Course's own Lesson
relations server-side, exactly as this endpoint does. This slice implements only the `GET`; explicit
selection and the mutating publish-selected endpoint are not implemented yet.

Readiness is read-only and takes no PostgreSQL advisory lock — nothing it reads is mutated, so it does
not need to serialize against `lockQuizPublicationBoundary`. A Lesson whose declared `type` has no
matching VideoLesson/DocumentLesson/QuizLesson detail row is provably impossible through this API
(`LessonService.createLesson` writes both atomically in one transaction); the endpoint fails loudly
with a `COURSE_DATA_INTEGRITY_VIOLATION` (500) in that case rather than silently reporting a corrupted
Lesson as ready. No Prisma schema or migration change was needed.

## Video and Document Metadata

Video metadata should be provider-independent: external/provider asset reference, upload/processing/playback readiness state, duration where known, failure reason/state, and storage/object reference where appropriate.

Do not store permanent signed playback URLs. Secure playback authorization should be generated at runtime after authorization checks. NestJS should not stream every video byte in production.

Document/PDF metadata should reference object storage/provider identity, file metadata, processing/protection state, and download/viewing policy. Do not store PDF binary data in PostgreSQL and do not duplicate files per student. Personalized watermarking should be applied at presentation/download time if implemented later.

## Quiz Model and Historical Integrity

V1 supports `MULTIPLE_CHOICE` and `TRUE_FALSE` questions.

Recommended strategy: keep editable quiz/question/option records for current authoring state, and snapshot the assessed quiz content into attempt answer snapshot fields when an attempt starts/submits.

At minimum, each submitted answer must retain question text, question type, option texts where applicable, selected answer(s), correct answer representation, points possible, and points awarded at attempt time. This avoids a large versioning engine while keeping completed attempts interpretable after instructors edit quizzes.

Quiz submission should be idempotent with a client request key or attempt state transition so mobile retries do not create duplicate scored attempts.

## Enrollment and Course Access

Enrollment is separate from authentication.

Access check concept:

```text
authenticated student
-> authorized device
-> active tenant-student association
-> active enrollment for tenant/course
-> available course/lesson/content
-> runtime content authorization
```

Enrollment should support active/inactive/revoked/expired state, optional start/end dates, tenant scope, granted-by user, and timestamps. No payment fields are involved.

Use constraints to avoid accidental duplicate active access for the same student/course where possible.

Enrollment is database-linked to `TenantStudent` through `(tenantId, studentUserId)` so a course entitlement cannot be created for a student who is not associated with the course tenant.

The backend now exposes the first tenant/student/enrollment API foundation: Platform Admin instructor creation/list/detail, instructor tenant-context reads, instructor tenant-scoped student association/list/detail, instructor enrollment create/revoke, and student enrollment listing. Student enrollment listing requires both Bearer authentication and student-device authorization. Course, section, lesson, content, and playback APIs remain deferred.

## Learning Progress

Persist useful V1 progress: lesson started, lesson completed, last accessed, video resume position, watched seconds where relevant, and completion timestamp where useful.

Course progress percentage can usually be derived from lesson progress and current course structure. Avoid persisting aggregate percentages unless later performance measurements justify it.

Progress update endpoints should be idempotent and monotonic where appropriate. Retried mobile requests should not reduce resume position or duplicate completion events unless the request explicitly represents a valid correction.

## Notifications

Notifications remain provider-independent in V1.

The backend should model in-app notification records with recipient, type/category, title/body or localization key payload, read timestamp, created timestamp, and optional domain reference. Do not choose push, email, SMS, or WhatsApp providers yet.

The implemented V1 notification boundary is a self-inbox model: students and instructors read only
notifications whose `recipientUserId` matches the authenticated principal. Student notification
routes compose access-token authentication with the same student device authorization guard used by
protected student app surfaces. Tenant-scoped notifications may carry `tenantId`; platform-level
notifications are represented by `tenantId = null` when explicitly created by a trusted internal
producer. See `docs/NOTIFICATIONS.md`.

## Security Events / Audit Trail

Security events are distinct from ordinary analytics.

Events should capture type, category/severity, actor user where applicable, target user where applicable, tenant where applicable, device/session references where applicable, timestamp, request/correlation ID, IP/user-agent summary where appropriate, and bounded structured metadata.

Never store secrets, passwords, raw access tokens, refresh tokens, private keys, or unnecessary PII in event metadata.

Retention should be policy-driven. Some security events may need limited retention for abuse investigation and support, but the design should not assume logs live forever.

## Account Status and Deletion Lifecycle

User status should support `ACTIVE`, `SUSPENDED`, `DELETION_REQUESTED`, and `DELETED`.

Deletion should not be a naive cascade. The future account deletion flow should delete or anonymize direct personal profile data where appropriate, preserve minimal operational/security records when required for legitimate business/legal/abuse-prevention purposes, keep quiz attempts/enrollments interpretable where retention is justified, remove or revoke active sessions/devices, and record a security/audit event without storing sensitive deletion payloads.

Final retention policy requires later legal/product review, but the schema should support both deletion and anonymization timestamps.

## Concurrency-Sensitive Operations

These operations must use transactions and/or concurrency controls in implementation:

- Device-change approval: preserve the one-active-device policy and prevent two concurrent approvals from activating two devices.
- Device revocation/switching: ensure old and new statuses change atomically.
- Enrollment create/revoke: avoid duplicate active enrollments and preserve revocation history.
- Quiz submission: ensure one final score per attempt and idempotent retry behavior.
- Course section/lesson reordering: preserve unique positions within a parent.
- Account deletion: transition identity, profile, sessions, devices, and retained records consistently.
- Progress updates: handle mobile retries without regressing progress or duplicating completion.

## API Boundary Implications

Future DTOs and API payloads must not mirror database rows blindly.

Important backend boundaries:

- Authentication identity resolution.
- Tenant resolution from membership/resource access.
- Authorization policies.
- Device authorization.
- Course entitlement.
- Content access/playback authorization.
- Admin-only security actions.

Internal fields such as password hashes, refresh/session secrets, provider asset references, security metadata, deletion markers, and raw audit metadata must not be exposed directly to clients.

Every bounded offset-paginated list response across the API shares one standard shape:
`{ items, limit, offset, hasMore }`. `hasMore` is computed from a `take: limit + 1` fetch (one row
beyond the page) rather than a second `COUNT(*)` query: `hasMore = rows.length > limit`, and the
sentinel row is trimmed off before it reaches `items` — never `items.length === limit`, which
misreports a next page when the result set ends exactly on a page boundary. For a list endpoint
whose page feeds a further page-scoped query (e.g. a reporting endpoint that aggregates by the
returned rows' IDs), the sentinel row must be trimmed before that follow-up query is built, so it
can never contribute to an aggregate for the returned page. `total` is not part of this contract.

## Failure-Case Review

- Same student studies with two instructors: supported through canonical `User` plus one `TenantStudent` association per tenant and tenant-scoped enrollments.
- Instructor accesses another tenant course: blocked by tenant membership/resource authorization.
- Client changes `tenantId`: ignored unless server verifies membership/resource access.
- Student shares password with another device: device authorization blocks protected access and triggers request/audit flow.
- Two device approvals concurrently: requires transactional status changes and partial unique active-device constraints.
- Student loses device: device-change request and Platform Admin approval handles replacement.
- Enrollment expires: active access check considers status and start/end dates.
- Section reordered: section/lesson ordering constraints plus transaction preserve positions.
- Student resumes video: lesson progress stores resume position.
- Mobile retries progress: idempotent/monotonic progress updates prevent duplicate or regressed state.
- Quiz edited after completion: attempt snapshots keep history interpretable.
- Quiz submitted twice after retry: idempotency key/attempt state prevents duplicate finalization.
- Account deletion requested: status and anonymization lifecycle support future compliant flow.
- Instructor suspended: account/member status checks disable access without deleting tenant records.
- Security log volume grows: security events are indexed for investigation and retention-managed.
- Course contains hundreds of lessons: ordered sections/lessons with pagination-friendly queries.
- Tenant has thousands of students: tenant/course enrollment indexes support list and access checks.

## Future Extension Boundaries

Deferred by design: OAuth/social login, advanced staff permission matrix, enterprise hierarchy, billing records, marketplace fields, DRM provider implementation, notification providers, advanced assessment engine, analytics warehouse, Redis/queues/search infrastructure, and sharding/distributed databases.
