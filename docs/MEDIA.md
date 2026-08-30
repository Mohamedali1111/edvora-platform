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

Student video playback (byte delivery) is still fully deferred: no VIDEO route exists.

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

## DRM-Ready Boundary

Edvora remains DRM-ready, not DRM-implemented. This slice does not claim DRM, simulate DRM, or choose a provider. DRM-capable provider evaluation remains a future technical and cost decision.
