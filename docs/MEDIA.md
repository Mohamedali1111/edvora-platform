# Media Foundation

This document records the media boundary for Edvora's V1 backend.

## Locked Provider Architecture

Edvora V1 media providers are now locked as:

- Documents: Cloudflare R2, using its S3-compatible API.
- Video: Bunny Stream Standard Network.

Only the Documents/R2 lifecycle is implemented here. Bunny Stream integration remains deferred; the
video provider decision is recorded only so future work does not reopen provider selection in
ordinary implementation slices.

## Implemented Scope

Media Slice A implements instructor-side tenant-scoped reads for existing, legitimately persisted
`VideoAsset` and `DocumentAsset` records:

- `GET /instructor/tenants/:tenantId/media/videos`
- `GET /instructor/tenants/:tenantId/media/videos/:videoAssetId`
- `GET /instructor/tenants/:tenantId/media/documents`
- `GET /instructor/tenants/:tenantId/media/documents/:documentAssetId`

These routes do not upload, proxy, stream, or download media bytes.

Media Slice D implements the first real provider-backed document lifecycle:

```text
authorized instructor client
-> backend creates a tenant-scoped DocumentAsset upload intent
-> backend issues a short-lived direct Cloudflare R2 PUT capability
-> instructor client uploads bytes directly to R2
-> instructor client asks backend to confirm the upload
-> backend HEADs the temporary R2 object key and verifies size/content type
-> backend copies the verified object to the final R2 object key
-> backend verifies the final object
-> DocumentAsset transitions from UPLOADING to READY with externalAssetRef set to the final key
```

Video asset creation/registration is still deferred until Bunny Stream integration exists. The
current schema's required `externalAssetRef` represents a real storage/provider reference, so the
API must not manufacture placeholder values such as fake pending-upload paths.

## Provider Boundaries

The API keeps media provider/storage details behind a backend boundary. Instructor responses expose
safe operational metadata only:

- IDs
- tenant ownership
- uploader ID
- processing status
- video duration when known
- document file name, MIME type, and size
- timestamps

Responses intentionally do not expose `externalAssetRef`, `providerKey`, failure details, signed
URLs, credentials, tokens, or provider secrets.

## Document Upload Boundary

The intended document upload architecture is:

```text
authorized instructor client
-> backend issues a short-lived provider upload intent
-> client uploads bytes directly to R2
-> backend verifies provider state before marking the asset READY
```

The rejected architecture is:

```text
Instructor client -> NestJS API -> Cloudflare R2
```

For documents, the backend issues a presigned R2 `PUT` URL scoped to one exact temporary upload key:

```text
tenants/{tenantId}/document-uploads/{documentAssetId}
```

The final READY object key is separate:

```text
tenants/{tenantId}/documents/{documentAssetId}
```

The backend alone generates `documentAssetId` and both R2 object keys. The client never supplies
`externalAssetRef`, object keys, tenant IDs in the body, uploader IDs, processing status, or provider
configuration. While the asset is `UPLOADING`, `DocumentAsset.externalAssetRef` truthfully stores
the temporary provider key. On successful confirmation, the backend atomically updates
`externalAssetRef` to the final key together with `processingStatus = READY`, so a READY asset never
references the still-mutable upload target. The user-supplied file name is presentation metadata
stored in `DocumentAsset.fileName`; it is deliberately not part of either authoritative R2 key,
avoiding path traversal concerns, Unicode/path semantic surprises, collisions, and coupling provider
keys to UI metadata.

The upload URL is a short-lived bearer capability, defaulting to approximately 10 minutes
(`MEDIA_DOCUMENTS_R2_UPLOAD_URL_TTL_SECONDS=600`). It is sensitive and must not be logged with its
signature. Required upload headers, currently `Content-Type`, are returned with the capability so the
client can perform the direct PUT. R2 credentials, bucket configuration, and raw provider settings
are never returned to clients.

NestJS never proxies document bytes. The only supported bytes path is:

```text
Instructor client -> Cloudflare R2
```

No multipart parser, Multer flow, or binary request-body upload route exists for documents. Document
upload intent metadata is intentionally narrow in V1: PDF only (`application/pdf`) with a 25 MiB
maximum. The repository does not currently specify a broader V1 document-format set, so the
implementation rejects arbitrary blobs, executables, HTML, scripts, archives, and generic binary
uploads.

### Confirmation And Readiness

`POST /instructor/tenants/:tenantId/media/documents/:documentAssetId/confirm-upload` never trusts a
client assertion that upload succeeded. It authorizes instructor tenant access, loads the
tenant-scoped `UPLOADING` asset, `HEAD`s the temporary R2 object key currently stored in
`DocumentAsset.externalAssetRef`, verifies object existence, verifies actual object size against
`DocumentAsset.fileSizeBytes`, and verifies content type when R2 metadata provides it. It then copies
the verified temporary object to the final key, verifies the final object, and only then can
`UPLOADING` become `READY` with `externalAssetRef` set to the final key.

The original presigned PUT is not single-use, but it only targets the temporary key. After READY, a
reused upload capability can at most overwrite the temporary upload object; it cannot mutate the
final object referenced by the READY `DocumentAsset`.

Confirmation is idempotent for already-`READY` assets and concurrent successful confirmations
converge on `READY`. State regression such as `READY -> UPLOADING` is not allowed. A missing object
or transient provider/network failure does not make the asset `READY`; transient provider failures
also do not mark the asset permanently failed. Copy/promote failure or final verification failure
also leaves the database non-READY so a retry can converge. If final copy succeeds but the database
update fails, the temporary object has not been deleted by the backend and retrying confirmation can
copy/verify again and complete the same final key. Temporary cleanup is best-effort after the final
object and READY database state exist; cleanup failure does not invalidate the READY asset because
the old PUT still targets only the temporary key. Definite invalid uploads, such as a size or
trustworthy content-type mismatch on the uploaded temporary object, may transition to `FAILED`.

No cleanup scheduler exists yet. Abandoned uploads may remain `UPLOADING`; future cleanup can
archive/delete stale upload intents and provider objects.

## Playback And Document Access

Student video playback byte delivery is still fully deferred: no route streams or proxies video
bytes. Media Slice C adds the runtime authorization boundary for VIDEO Lessons, proving whether a
student may play a specific video now without moving any video bytes or issuing any real playback
capability.

Student DOCUMENT Lesson access now extends the Media Slice B authorization boundary with real
short-lived Cloudflare R2 download capability issuance. It still composes exactly:

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
already enforces for Course/Quiz reads, extended by one focused method,
`assertAccessibleDocumentLesson`, mirroring how `assertAccessibleQuizLesson` extends it for QUIZ
lessons. Student download issuance does not duplicate the entitlement predicate; it calls this one
method from `StudentDocumentAccessService` in the Media module.

`GET /student/courses/:courseId/lessons/:lessonId/document/access` is the only student-facing route.
It is structurally bound to the Course/Lesson path; there is no `/student/documents/:documentAssetId`
route, so a document can never be reached by guessing or supplying a bare `documentAssetId`. The
client supplies no `tenantId`, `studentUserId`, `enrollmentId`, or `documentAssetId`; all four are
derived entirely server-side from the authorized Lesson. GET creates a short-lived bearer capability,
but it remains a pure authorization/capability issuance read: it creates no `LessonProgress` row,
mutates no `Enrollment`, writes no access-history row, and does not persist the signed URL.

### Readiness Requirement

Runtime student access requires `DocumentAsset.processingStatus == READY`. A Lesson may legitimately
reference a DocumentAsset that is still `UPLOADING`/`PROCESSING`, or ended up `FAILED`/`ARCHIVED`;
Media Slice A's instructor authoring flow permits attaching a Lesson to an asset before it is ready,
since authoring and student runtime access are different concerns with different strictness. Student
runtime access enforces the stricter rule: a non-`READY` asset is treated exactly like an unavailable
Lesson and denied with the same `LESSON_NOT_FOUND` response used for every other unavailable-Lesson
case. No existence is leaked, and no new error taxonomy was introduced for this.

### What The Endpoint Returns, And What It Deliberately Does Not

Once authorization succeeds, the endpoint issues a presigned R2/S3 `GET` capability for the
already-finalized `DocumentAsset.externalAssetRef`. That persisted key must exactly match:

```text
tenants/{tenantId}/documents/{documentAssetId}
```

The download capability must never target the temporary upload namespace:

```text
tenants/{tenantId}/document-uploads/{documentAssetId}
```

`StudentDocumentAccessService` validates that READY storage invariant before signing. If the database
somehow contains a READY document whose `externalAssetRef` still points at a temporary upload key,
the request fails instead of issuing a capability for mutable upload storage.

The response carries only `lessonId`, `fileName`, `mimeType`, `fileSizeBytes`, `downloadUrl`, and
`expiresAt`. It never includes `documentAssetId`, `tenantId`, `externalAssetRef`, R2 bucket/account
configuration, credentials, or permanent/public provider URLs. The presigned `downloadUrl` is
intentionally returned and must be treated as a sensitive short-lived bearer capability. The default
download TTL is 5 minutes (`MEDIA_DOCUMENTS_R2_DOWNLOAD_URL_TTL_SECONDS=300`), validated between 60
and 900 seconds.

NestJS never streams, proxies, buffers, or parses document bytes. The only supported student document
bytes path is:

```text
Cloudflare R2 -> student client
```

No `Content-Disposition` override is signed in this slice. The persisted display `fileName` is
returned separately, avoiding filename-to-header construction risk while leaving a future provider-
supported download-header refinement possible. A presigned URL is not DRM and does not prevent
copying, redistribution, screenshots, or piracy; those remain separate future controls.

## Video Playback Authorization (Media Slice C)

Media Slice C implements the runtime authorization boundary for student VIDEO Lesson playback,
proving who may play which video when, without issuing any real playback capability. It composes
exactly the same canonical chain as Document Slice B, with the Lesson type and asset swapped:

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

This reuses `StudentCourseAccessService.assertStudentCourseAccess`, extended by one focused method,
`assertAccessibleVideoLesson`, mirroring `assertAccessibleDocumentLesson`/
`assertAccessibleQuizLesson` exactly. Media Slice C does not duplicate the entitlement predicate; it
calls this one method from `StudentVideoAccessService` in the Media module.

`GET /student/courses/:courseId/lessons/:lessonId/video/access` is the only student-facing route. It
is structurally bound to the Course/Lesson path; there is no `/student/videos/:videoAssetId` route,
so a video can never be reached by guessing or supplying a bare `videoAssetId`. The client supplies
no `tenantId`, `studentUserId`, `enrollmentId`, or `videoAssetId`; all four are derived entirely
server-side from the authorized Lesson. GET, not POST, because this is a pure authorization read. It
creates no `LessonProgress` row, does not mark the Lesson completed, creates no `QuizAttempt`,
mutates no `Enrollment`, and records no watch time or playback/session row.

### Readiness Requirement

Runtime student playback authorization requires `VideoAsset.processingStatus == READY`, exactly
mirroring Document Slice B's rule. A Lesson may legitimately reference a VideoAsset that is still
`UPLOADING`/`PROCESSING`, or ended up `FAILED`/`ARCHIVED`; Media Slice A's instructor authoring flow
permits attaching a Lesson to an asset before it is ready. Student runtime access enforces the
stricter rule: a non-`READY` asset is treated exactly like an unavailable Lesson and denied with the
same `LESSON_NOT_FOUND` response used for every other unavailable-Lesson case.

### What The Endpoint Returns, And What It Deliberately Does Not

Since Bunny Stream integration has not been implemented, this endpoint does not fabricate a playback
URL, signed URL, playback token, provider-issued JWT, DRM license URL, or provider asset ID. Once
authorization succeeds, the response carries only `durationSeconds` plus `ready: true` and an
`authorizedAt` timestamp proving a real, just-performed authorization decision. It never includes
`videoAssetId`, `externalAssetRef`, `providerKey`, `processingStatus`, failure details, or any other
instructor-authoring/provider-internal field.

`StudentVideoAccessService.getVideoAccess` is the exact point in code where a future Bunny Stream
playback capability belongs: right after `assertAccessibleVideoLesson` resolves a proven
`(tenantId, videoAssetId)` pair, and before the response is returned.

Permanent raw/public media URLs must never become the authorization model. Signed/ephemeral playback
issuance itself remains deferred until Bunny Stream integration is implemented.

### Instructor Media Surface Unchanged

Media Slice A's instructor `VideoAsset` list/detail routes and response fields are unchanged by this
slice. No VideoAsset create/update endpoint was added; provider-backed video creation remains
deferred.

## DRM-Ready Boundary

Edvora remains DRM-ready, not DRM-implemented. This slice does not claim DRM, simulate DRM, or
implement Bunny Stream. DRM enforcement remains a future provider-specific integration layer. Media
Slice C preserves the same separation: Edvora's own authorization decision is distinct from any
future provider-issued playback capability, which is itself distinct from any future DRM/license
enforcement layered on top of it. No custom encryption, homemade DRM, or fake DRM token is
implemented anywhere in this codebase, and no claim is made that screen recording can be fully
prevented.
