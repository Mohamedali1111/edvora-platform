# Media Foundation

This document records the provider-independent media boundary for Edvora's V1 backend.

## Implemented Scope

Media Slice A implements instructor-side tenant-scoped reads for existing, legitimately persisted `VideoAsset` and `DocumentAsset` records:

- `GET /instructor/tenants/:tenantId/media/videos`
- `GET /instructor/tenants/:tenantId/media/videos/:videoAssetId`
- `GET /instructor/tenants/:tenantId/media/documents`
- `GET /instructor/tenants/:tenantId/media/documents/:documentAssetId`

These routes do not upload, proxy, stream, or download media bytes.

Asset creation/registration is intentionally deferred until a real provider-backed upload-intent or provider-ingestion boundary exists. The current schema's required `externalAssetRef` represents a real storage/provider reference, so the API must not manufacture placeholder values such as fake pending-upload paths.

## Provider Independence

The API keeps media provider/storage details behind a backend boundary. Instructor responses expose safe operational metadata only:

- IDs
- tenant ownership
- uploader ID
- processing status
- video duration when known
- document file name, MIME type, and size
- timestamps

Responses intentionally do not expose `externalAssetRef`, `providerKey`, failure details, signed URLs, credentials, tokens, or provider secrets.

## Upload Boundary

The intended upload architecture is:

```text
authorized instructor client
-> backend issues a short-lived provider upload intent
-> client uploads bytes directly to storage/video provider
-> provider/backend updates asset processing state
```

The rejected architecture is:

```text
client
-> NestJS API
-> large media bytes
-> provider/storage
```

Slice A does not implement upload intents because no storage/video provider has been selected. It also does not fabricate fake upload URLs or permanent public media URLs.

## Playback And Document Access

Student video playback (byte delivery) is still fully deferred: no route streams or proxies video
bytes. Media Slice C adds the runtime **authorization boundary** for VIDEO Lessons (see below) —
proving whether a student may play a specific video now — without moving any video bytes or
issuing any real playback capability.

Media Slice B implements the runtime **authorization boundary** for student DOCUMENT Lesson
access — proving *who* may access *which* document and *when* — without yet issuing any real
download capability, because no storage/video provider has been selected. It composes exactly:

```text
AccessTokenGuard
-> StudentDeviceGuard
-> DB-fresh ACTIVE STUDENT
-> ACTIVE TenantStudent
-> current ACTIVE/time-valid Enrollment
-> PUBLISHED Course
-> PUBLISHED Section
-> PUBLISHED/available DOCUMENT Lesson
-> tenant-scoped linked DocumentAsset, READY only
```

This is the exact same canonical chain `StudentCourseAccessService.assertStudentCourseAccess`
already enforces for Course/Quiz reads, extended by one new focused method,
`assertAccessibleDocumentLesson`, mirroring how `assertAccessibleQuizLesson` extends it for QUIZ
lessons. Media Slice B does not duplicate the entitlement predicate — it calls this one method
from a new `StudentDocumentAccessService` in the Media module.

`GET /student/courses/:courseId/lessons/:lessonId/document/access` is the only student-facing
route. It is structurally bound to the Course/Lesson path — there is no
`/student/documents/:documentAssetId` route, so a document can never be reached by guessing or
supplying a bare `documentAssetId`. The client supplies no `tenantId`, `studentUserId`,
`enrollmentId`, or `documentAssetId`; all four are derived entirely server-side from the
authorized Lesson. GET, not POST, because this is a pure authorization read, not an action that
generates anything — it creates no `LessonProgress` row, mutates no `Enrollment`, and writes no
access-history row.

### Readiness requirement

Runtime student access requires `DocumentAsset.processingStatus == READY`. A Lesson may
legitimately reference a DocumentAsset that is still `UPLOADING`/`PROCESSING`, or ended up
`FAILED`/`ARCHIVED` — Media Slice A's instructor authoring flow permits attaching a Lesson to an
asset before it is ready, since authoring and student runtime access are different concerns with
different strictness. Student runtime access enforces the stricter rule: a non-`READY` asset is
treated exactly like an unavailable Lesson and denied with the same `LESSON_NOT_FOUND` response
used for every other unavailable-Lesson case — no existence is leaked, and no new error taxonomy
was introduced for this.

### What the endpoint returns, and what it deliberately does not

Since no storage/video provider has been selected, this endpoint does not fabricate a signed URL,
download token, provider credential, or any other ephemeral access capability — doing so would
misrepresent a capability that does not exist. Once authorization succeeds, the response carries
only the same class of safe, already-established display metadata the student Course structure
endpoint exposes for a DOCUMENT lesson (`fileName`, `mimeType`, `fileSizeBytes`), plus `ready:
true` and an `authorizedAt` timestamp proving a real, just-performed authorization decision. It
never includes `documentAssetId`, `externalAssetRef`, `providerKey`, `processingStatus`, or any
other instructor-authoring/provider-internal field — the same separation Media Slice A and Course
Slice C already established for their own responses.

### The provider seam, deliberately not a formal interface yet

The intended future architecture is:

```text
student authorization service proves access (StudentCourseAccessService / StudentDocumentAccessService)
-> provider/media port issues a real ephemeral access capability
-> client receives a short-lived signed URL/token, never a permanent one
```

`StudentDocumentAccessService.getDocumentAccess` is the exact point in code where a future
provider call belongs — right after `assertAccessibleDocumentLesson` resolves a proven
`(tenantId, documentAssetId)` pair, and before the response is returned. This slice deliberately
does not introduce a formal TypeScript interface/port for that call: with no provider selected and
no second implementation to satisfy it, a premature interface would be exactly the kind of
speculative abstraction `AGENTS.md` warns against. The seam is documented here in prose and in the
service's own code comments instead, so a future provider-integration slice has an unambiguous,
single insertion point.

Permanent raw/public media URLs must never become the authorization model. Signed/ephemeral
download issuance itself remains deferred until a provider is selected.

## Video Playback Authorization (Media Slice C)

Media Slice C implements the runtime **authorization boundary** for student VIDEO Lesson
playback — proving *who* may play *which* video *when* — without issuing any real playback
capability, because no video/streaming provider has been selected. It composes exactly the same
canonical chain as Document Slice B, with the Lesson type and asset swapped:

```text
AccessTokenGuard
-> StudentDeviceGuard
-> DB-fresh ACTIVE STUDENT
-> ACTIVE TenantStudent
-> current ACTIVE/time-valid Enrollment
-> PUBLISHED Course
-> PUBLISHED Section
-> PUBLISHED/available VIDEO Lesson
-> tenant-scoped linked VideoAsset, READY only
```

This reuses `StudentCourseAccessService.assertStudentCourseAccess`, extended by one new focused
method, `assertAccessibleVideoLesson`, mirroring `assertAccessibleDocumentLesson`/
`assertAccessibleQuizLesson` exactly. Media Slice C does not duplicate the entitlement predicate —
it calls this one method from a new `StudentVideoAccessService` in the Media module.

`GET /student/courses/:courseId/lessons/:lessonId/video/access` is the only student-facing route.
It is structurally bound to the Course/Lesson path — there is no `/student/videos/:videoAssetId`
route, so a video can never be reached by guessing or supplying a bare `videoAssetId`. The client
supplies no `tenantId`, `studentUserId`, `enrollmentId`, or `videoAssetId`; all four are derived
entirely server-side from the authorized Lesson. GET, not POST, because this is a pure
authorization read, not an action that generates anything — it creates no `LessonProgress` row,
does not mark the Lesson completed, creates no `QuizAttempt`, mutates no `Enrollment`, and records
no watch time or playback/session row (no such model exists in the current schema).

### Readiness requirement

Runtime student playback authorization requires `VideoAsset.processingStatus == READY`, exactly
mirroring Document Slice B's rule. A Lesson may legitimately reference a VideoAsset that is still
`UPLOADING`/`PROCESSING`, or ended up `FAILED`/`ARCHIVED` — Media Slice A's instructor authoring
flow permits attaching a Lesson to an asset before it is ready. Student runtime access enforces
the stricter rule: a non-`READY` asset is treated exactly like an unavailable Lesson and denied
with the same `LESSON_NOT_FOUND` response used for every other unavailable-Lesson case — no
existence is leaked, and no new error taxonomy was introduced.

### What the endpoint returns, and what it deliberately does not

Since no video/streaming provider has been selected, this endpoint does not fabricate a playback
URL (HLS/DASH or otherwise), signed URL, playback token, provider-issued JWT, DRM license URL, or
provider asset ID — doing so would misrepresent a capability that does not exist. Once
authorization succeeds, the response carries only `durationSeconds` (the one video display field
the student Course structure endpoint already exposes for a VIDEO lesson), plus `ready: true` and
an `authorizedAt` timestamp proving a real, just-performed authorization decision. It never
includes `videoAssetId` (there is no concrete client need for it yet), `externalAssetRef`,
`providerKey`, `processingStatus`, failure details, or any other instructor-authoring/
provider-internal field — the same separation Media Slice A/B and Course Slice C already
established for their own responses.

### The provider seam, deliberately not a formal interface yet

The intended future architecture is:

```text
student authorization service proves access (StudentCourseAccessService / StudentVideoAccessService)
-> provider/media port issues a real ephemeral playback capability
-> client receives a short-lived signed URL/token/playback session, never a permanent one
-> optional, separate: provider-specific DRM/license enforcement
```

`StudentVideoAccessService.getVideoAccess` is the exact point in code where a future provider call
belongs — right after `assertAccessibleVideoLesson` resolves a proven `(tenantId, videoAssetId)`
pair, and before the response is returned. As with Document Slice B, this slice deliberately does
not introduce a formal TypeScript interface/port for that call: with no provider selected and no
second implementation to satisfy it, a premature interface would be exactly the kind of
speculative abstraction `AGENTS.md` warns against. The seam is documented here in prose and in the
service's own code comments instead.

Permanent raw/public media URLs must never become the authorization model. Signed/ephemeral
playback issuance itself remains deferred until a video/streaming provider is selected.

### Instructor media surface unchanged

Media Slice A's instructor `VideoAsset` list/detail routes and response fields are unchanged by
this slice. No VideoAsset create/update endpoint was added; provider-backed creation remains
deferred.

## DRM-Ready Boundary

Edvora remains DRM-ready, not DRM-implemented. This slice does not claim DRM, simulate DRM, or choose a provider. DRM-capable provider evaluation remains a future technical and cost decision. Media Slice C preserves the same separation: Edvora's own authorization decision (proven here) is distinct from any future provider-issued playback capability, which is itself distinct from any future, entirely provider-specific DRM/license enforcement layered on top of it. No custom encryption, homemade DRM, or fake DRM token is implemented anywhere in this codebase, and no claim is made that screen recording can be fully prevented.
