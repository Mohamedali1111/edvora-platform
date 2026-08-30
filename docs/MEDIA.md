# Media Foundation

This document records the media boundary for Edvora's V1 backend.

## Locked Provider Architecture

Edvora V1 media providers are now locked as:

- Documents: Cloudflare R2, using its S3-compatible API.
- Video: Bunny Stream Standard Network.

Documents use Cloudflare R2. Video upload and processing use Bunny Stream on the Standard Network
tier. Student playback capability issuance is now implemented (Media Slice G): the student VIDEO
Lesson access route issues a real, short-lived, path-scoped Bunny HLS playback capability.

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

Video asset creation is provider-backed. The current schema's required `externalAssetRef` represents
a real provider reference, so the API must not manufacture placeholder values such as fake
pending-upload paths.

Media Slice F implements the Bunny upload/processing lifecycle:

```text
authorized instructor client
-> backend creates a real Bunny Stream video resource
-> backend persists VideoAsset with externalAssetRef = Bunny video GUID
-> backend issues a short-lived Bunny TUS upload capability
-> instructor client uploads bytes directly to Bunny TUS
-> Bunny processes/transcodes
-> Bunny signed webhook updates VideoAsset status monotonically
```

The supported route is:

```text
POST /instructor/tenants/:tenantId/media/videos/upload-intents
```

The request only accepts Edvora metadata needed to create the provider object (`title`). The client
does not supply `tenantId` in the body, uploader identity, `VideoAsset` ID, provider key, provider
GUID, or processing status. On success the backend stores:

- `id`: backend-generated Edvora UUIDv7.
- `tenantId`: route tenant after instructor authorization.
- `uploadedByUserId`: authenticated instructor user ID.
- `providerKey`: configured Bunny Stream Library ID.
- `externalAssetRef`: the real Bunny Stream video GUID returned by Create Video.
- `processingStatus`: `UPLOADING`.

The response is a short-lived upload-scoped bearer capability only: `videoAssetId`, Bunny TUS
endpoint, expiry, and required TUS headers (`AuthorizationSignature`, `AuthorizationExpire`,
`VideoId`, `LibraryId`). Bunny's API key and webhook signing secret stay backend-only. Bunny's
Library ID and video GUID are exposed only because Bunny TUS requires them as upload metadata; they
are provider identifiers, not authorization secrets by themselves.

Video bytes never pass through NestJS. The only supported upload bytes path is:

```text
Instructor client -> Bunny Stream TUS
```

No multipart/video-body upload route exists.

Ordering is intentionally conservative. Bunny resource creation happens before DB persistence, so a
Bunny create failure creates no Edvora asset. If DB insert fails after Bunny creation, the Bunny
object may be temporarily orphaned; this is preferable to durable corrupt Edvora state and cleanup is
deferred. If TUS signing fails after Bunny creation and DB persistence, the asset is moved to
`FAILED` with `VIDEO_UPLOAD_SIGNING_FAILED`, so clients cannot be misled into uploading against a
non-issued capability. No cleanup scheduler exists yet.

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

### PDF Content Verification Trust Boundary (Media Slice H Audit)

Confirmation verifies the declared MIME type (`application/pdf`, enforced by DTO validation and
cryptographically bound into the R2 presigned PUT's `Content-Type`, so a client cannot successfully
upload with a different header value) and the exact declared file size against R2's own reported
object metadata. It does **not** inspect the uploaded bytes themselves (no PDF magic-number/file-type
sniffing). A byte-level check was deliberately not added in this slice: doing it correctly would mean
either downloading the full object (up to 25 MiB) through NestJS to inspect it — reintroducing exactly
the "bytes flow through the API" architecture this module otherwise avoids everywhere — or adding a
new partial-range R2 `GET` call with its own retry/failure semantics, for a benefit that is narrow
given the actual trust boundary: only an authenticated, ACTIVE, tenant-membership-verified
**instructor** can ever create a document upload intent (never a student, never an unauthenticated
caller), and the uploaded object is never parsed, rendered, or executed anywhere in this backend —
it is only ever handed back to a student as an opaque, short-lived signed download URL, to be opened
by whatever PDF viewer exists on that student's own device. A mismatched-content file uploaded by a
malicious or careless instructor is a real but low-severity, narrow-blast-radius risk (bounded to
that instructor's own tenant and content, and to whatever the student's own OS/app does with a
misnamed file), not a server-side code-execution or cross-tenant risk. If a concrete future need
arises (e.g. instructor self-service at a much larger scale, or a lower-trust upload actor), a
lightweight partial-range magic-byte check is the recommended addition — not full-file proxying.

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

Video bytes never flow through NestJS: no route streams, buffers, or proxies video bytes — the only
supported path is Bunny CDN -> student client. Media Slice C added the runtime authorization boundary
for VIDEO Lessons; Media Slice G (below) extends it with real, short-lived Bunny playback capability
issuance once that authorization succeeds.

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

As of Media Slice G (see below), this endpoint issues a real, short-lived Bunny Stream HLS playback
capability once authorization succeeds. The response carries only `lessonId`, `durationSeconds`,
`playbackUrl`, and `expiresAt`. It never includes `videoAssetId`, `externalAssetRef`, `providerKey`,
`processingStatus`, failure details, Bunny credentials/secrets, or any other
instructor-authoring/provider-internal field as a separate field — the Bunny video GUID does appear
embedded inside `playbackUrl`'s signed path, which is acceptable as part of the short-lived
capability itself.

Permanent raw/public media URLs must never become the authorization model. `playbackUrl` is a
sensitive, short-lived bearer capability — see Media Slice G for its exact construction, TTL
reasoning, and limitations.

## Protected Bunny Video Playback Capability (Media Slice G)

Media Slice G extends the Slice C authorization boundary with real Bunny Stream playback capability
issuance. The security boundary is unchanged: `GET
/student/courses/:courseId/lessons/:lessonId/video/access` still composes `AccessTokenGuard` ->
`StudentDeviceGuard` -> `StudentCourseAccessService.assertAccessibleVideoLesson`, and playback
signing happens only after that chain proves ACTIVE STUDENT -> approved device -> ACTIVE
TenantStudent -> valid ACTIVE Enrollment -> ACTIVE Tenant -> PUBLISHED Course/Section/Lesson ->
tenant-linked READY `VideoAsset`. `assertAccessibleVideoLesson` was extended (not duplicated) to also
return the proven asset's own `providerKey`/`externalAssetRef`, so `StudentVideoAccessService` never
re-queries or accepts these from the client.

### Two Different Bunny Token Mechanisms, And Why We Use The Other One

Bunny Stream has two independent security mechanisms that are easy to conflate:

1. **Embed/iframe view token** (`bunny.net/docs/stream/token-authentication`):
   `token = SHA256_HEX(security_key + video_id + expires)`, checked only on
   `https://iframe.mediadelivery.net/embed/{libraryId}/{videoId}?token=...&expires=...`. This gates
   Bunny's own iframe player page. It does **not** protect the underlying HLS files a native player
   fetches — a design that would leave the manifest gated but every segment URL freely reusable once
   observed. This slice deliberately does not return an iframe/embed URL at all.
2. **CDN Pull Zone token authentication** (`bunny.net/docs/cdn/security/token-authentication/advanced`),
   which `bunny.net/docs/stream/security` documents as operating "at the Pull Zone level" and
   protecting "MP4 fallbacks, HLS playlists and segments, thumbnails, and previews" for Bunny Stream's
   underlying storage. This is the mechanism Slice G uses.

### Path-Style (Directory) Token Construction

Every file for one video — `playlist.m3u8`, every per-resolution sub-playlist, and every segment —
lives under one Bunny-managed prefix, `/{videoId}/` (Bunny's "Video storage structure" docs). Slice G
signs a **directory-scoped** CDN token bound to exactly that prefix (`token_path=/{videoId}/`), so one
signature authorizes the manifest and every segment/quality file a player resolves relative to it —
never a manifest-only token that leaves segment requests unprotected — while staying scoped to this
one video and never reusable for another.

The token is embedded as a **URL path segment**, not a query string:

```text
https://{cdnHostname}/bcdn_token={token}&token_path=%2F{videoId}%2F&expires={unixSeconds}/{videoId}/playlist.m3u8
```

This is Bunny's documented "directory token" pattern, and it is deliberately chosen over a
query-string token (`?token=...&expires=...` on the manifest URL) because of how native HLS players
resolve relative URIs: an `AVPlayer`/`ExoPlayer`/`expo-video` client resolves each segment URL
relative to everything *before the last `/`* of the manifest URL it fetched. A path-embedded token
prefix (`/bcdn_token=...&expires=.../{videoId}/`) is carried forward into every derived segment
request automatically, with no player-side code needed. A query-string token would not be: the
player would have to re-append `?token=...` to every derived segment URL itself, which native HLS
player stacks generally do not support without custom interception — the documented limitation this
design avoids.

The exact HMAC construction (independently reproduced from Bunny's own official reference
implementation, `github.com/BunnyWay/BunnyCDN.TokenAuthentication`, and verified byte-for-byte
against its published test vectors before implementation):

```text
signingData = "token_path=" + tokenPath
digest      = HMAC-SHA256(key = tokenAuthenticationKey,
                           message = tokenPath || expires || signingData)
token       = "HS256-" + base64url(digest)   // '+'->'-', '/'->'_', no '=' padding
```

`BunnyStreamVideoProvider.createPlaybackCapability` implements this directly (no Bunny SDK
dependency, consistent with how the existing TUS/webhook code already does its own crypto). It
refuses to sign a `videoId` that is not a well-formed Bunny GUID rather than embedding arbitrary
input into a path — see the READY/provider-identity invariant below.

### TTL Decision

Bunny's directory-token `expires` is one fixed wall-clock deadline checked on every request under the
signed path — it is **not** a sliding per-segment or per-session window. A flat short TTL (e.g. a flat
~5 minutes) would therefore return 403 mid-playback for any lecture longer than that, the exact
failure mode `AGENTS.md`-level product judgment must avoid. Slice G instead computes TTL from the
specific video's own known `durationSeconds`:

```text
ttl = clamp(durationSeconds + 900s buffer, 300s, 14400s)     // 5 min .. 4 hours
```

with a bounded fallback of 7200s (2 hours) — not the 4-hour maximum — when `durationSeconds` is
unknown. The 15-minute buffer covers the gap between authorization and first byte, pausing, and
seeking backward into already-played segments after the video's nominal end point. The 4-hour ceiling
keeps even an unusually long recording bounded and short-lived rather than defaulting to a
multi-hour/day TTL "to be safe." If a student's session outlives the issued TTL, the client simply
calls the same authorized route again for a fresh capability — no playback-session state exists to
resume.

### IP Binding: Disabled For V1

Bunny's CDN token authentication supports optional IP binding (`user_ip`) folded into the signature.
Slice G does **not** enable it. Reasoning: Egyptian/MENA mobile carriers frequently rotate client IPs
mid-session (CGNAT, cell tower handoff, Wi-Fi/cellular switching), and IP-bound tokens would then fail
requests from a legitimate device mid-playback — a reliability cost with no corresponding security
benefit for V1, since the capability is already short-lived, scoped to one video, and reachable only
through the full server-side entitlement chain. This is a deliberate, documented choice, not an
oversight; it can be revisited if a future threat model specifically requires it.

### Provider Identity Safety (READY/Final Invariant)

Only a READY `VideoAsset` ever reaches signing. Two independent checks guard against signing the
wrong or a malformed path, both leaving the `VideoAsset`/`Enrollment`/progress state completely
untouched on failure (`VideoAssetProviderInvariantViolationError` /
`VideoPlaybackSigningFailedError`, both mapped to `502 Bad Gateway`, never leaking internals):

- `StudentVideoAccessService` rejects if the asset's persisted `providerKey` does not equal the
  currently configured Bunny Stream library ID (`VideoProvider.providerKey`) — e.g. an asset created
  against a different library.
- `BunnyStreamVideoProvider.createPlaybackCapability` rejects if `externalAssetRef` is not a
  well-formed Bunny GUID, refusing to sign an arbitrary path.

Both checks run before any HMAC computation. Playback signing is a synchronous, local computation
with no network call, so there is no genuinely transient failure mode beyond these two validations —
unlike document/video upload signing, there is nothing to retry.

### Response Safety, Logging, And Persistence

The response (`lessonId`, `durationSeconds`, `playbackUrl`, `expiresAt`) never includes
`videoAssetId`, `tenantId`, `providerKey`, `externalAssetRef` as a separate field, or any Bunny
credential (API key, webhook signing secret, token authentication key). `playbackUrl` is sensitive
short-lived bearer material: it is never logged, never persisted to any table, and never written into
`SecurityEvent`. This slice creates no playback-audit or watch-session row of any kind. Repeated
authorized calls simply issue a fresh capability each time (no persistence, no caching, no reuse of a
prior signature); there is no server-side notion of a "playback session" to create, resume, or clean
up.

### Native Mobile Compatibility

`playbackUrl` is a direct `playlist.m3u8` HLS URL, consumable by a standard native HLS player stack —
`AVPlayer` on iOS, `ExoPlayer`/Media3 on Android (e.g. through `expo-video`) — with **no custom
per-segment backend calls**: the path-embedded token is carried forward automatically by ordinary
relative-URL resolution for every quality sub-playlist and segment request, exactly as reasoned about
above. Nothing about this response is iframe/WebView-shaped, and nothing precludes reusing the same
`VideoProvider.createPlaybackCapability` seam for a future web player.

### What This Is Not

A signed, short-lived playback URL is authorization, not DRM. It does not prevent screen recording,
copying after legitimate playback starts, or redistribution once bytes reach the device. No DRM
(MediaCage Basic/Enterprise, Widevine, FairPlay, or a license exchange) is enabled or claimed by this
slice; DRM remains explicitly future, provider-specific work. Video bytes still never flow through
NestJS — the only supported path is Bunny CDN -> student client — and no manifest rewriting or
segment proxying was introduced; the path-style token is Bunny's own documented mechanism, applied
directly at the CDN edge.

## Bunny Stream Webhooks

Bunny callbacks are received at:

```text
POST /provider-webhooks/bunny/stream
```

This route does not use student or instructor authentication. Authentication is the Bunny Stream
webhook signature. Edvora verifies Bunny v1 headers
`X-BunnyStream-Signature-Version: v1`,
`X-BunnyStream-Signature-Algorithm: hmac-sha256`, and `X-BunnyStream-Signature`, using
HMAC-SHA256 over the exact raw request body and timing-safe comparison. Bunny v1 does not include a
timestamp/replay-expiry equivalent, so Edvora's replay safety is enforced by the `VideoAsset` state
machine. Replayed valid webhooks are safe no-ops, and stale earlier webhooks cannot regress `READY`.

Webhook updates locate an asset only by the provider identity Edvora already persisted:

```text
providerKey = Bunny Stream Library ID
externalAssetRef = Bunny Stream video GUID
```

The webhook payload cannot redirect an update to an arbitrary tenant asset. Valid callbacks for an
unknown library/video pair return success as a safe no-op, avoiding provider retry loops while
leaking no tenant or user data.

Bunny status mapping:

- `0` Queued and `6` PresignedUploadStarted -> Edvora `UPLOADING`.
- `1` Processing, `2` Encoding, `4` ResolutionFinished, and `7` PresignedUploadFinished -> Edvora
  `PROCESSING`.
- `3` Finished -> Edvora `READY`.
- `5` Failed -> Edvora `FAILED` with `BUNNY_STREAM_ENCODING_FAILED`.
- `8` PresignedUploadFailed -> Edvora `FAILED` with `BUNNY_STREAM_PRESIGNED_UPLOAD_FAILED`.
- `9` CaptionsGenerated and `10` TitleOrDescriptionGenerated -> ignored for asset readiness.

Bunny status `4` means a single resolution is ready/playable, but Edvora does not treat that as
`READY`; student video authorization still denies until status `3` confirms the video is fully
finished. When a trusted webhook supplies duration, Edvora stores it as `VideoAsset.durationSeconds`.

### Exact Per-Target Transition Sets (Media Slice H Audit)

`MediaAssetService.handleVideoProviderWebhook` guards every transition with an explicit source-state
allowlist, enforced as a single atomic conditional `updateMany` per target (never a separate
read-then-write), so concurrent/out-of-order webhooks for the same video converge correctly:

| Target       | Allowed source states                 |
| ------------ | -------------------------------------- |
| `UPLOADING`  | `UPLOADING`                            |
| `PROCESSING` | `UPLOADING`, `PROCESSING`               |
| `READY`      | `UPLOADING`, `PROCESSING`, `FAILED`     |
| `FAILED`     | `UPLOADING`, `PROCESSING`               |

`READY` is a genuine terminal state with respect to webhooks: no target's allowlist includes `READY`
as a source, so nothing (a stale/replayed webhook, a later `FAILED`, a duplicate `READY`) can ever
regress it. `FAILED -> READY` is deliberately allowed and is not a bug: Bunny's own TUS upload
protocol is resumable, so a real, legitimate sequence is upload interruption (Bunny reports status
`8`, Edvora records `FAILED`) followed by the instructor's client resuming the same TUS session,
after which Bunny's pipeline genuinely completes and reports status `3`. Because every transition is
authenticated by Bunny's HMAC-verified webhook signature and matched to an existing row by the exact
`(providerKey, externalAssetRef)` pair already persisted from `createVideoUploadIntent`, there is no
way for this to let an attacker mark an arbitrary or foreign asset `READY` — the transition only ever
reflects Bunny's own authoritative processing state for that exact video.

### Instructor Media Surface Unchanged

Media Slice A's instructor `VideoAsset` list/detail routes and response fields are unchanged by this
slice. No VideoAsset create/update endpoint was added; provider-backed video creation remains
deferred.

## Cleanup / Orphan Policy (Media Slice H Decision)

No cleanup scheduler, cron job, or background worker exists for Media in V1, and this slice
deliberately did not add one — there is no CI/CD or scheduler infrastructure in this repository yet
(see `AGENTS.md`), and building one solely to justify this audit slice would be exactly the kind of
unrequested infrastructure/scope expansion `AGENTS.md` warns against. This section documents the
explicit, reviewed operational policy that governs V1 instead.

### What Can Accumulate

- **Stale `UPLOADING` `DocumentAsset`/`VideoAsset` rows**: created whenever an instructor starts an
  upload intent but never completes it (never PUTs to R2 / never performs the Bunny TUS upload, or
  performs it but never calls `confirm-upload` for documents). These rows persist indefinitely.
- **Stale temporary R2 objects** at `tenants/{tenantId}/document-uploads/{documentAssetId}`: exist
  when an instructor's client successfully PUTs bytes but the asset is never confirmed.
- **Orphaned final R2 objects**: `promoteObject` succeeds but the subsequent DB `updateMany` to
  `READY` fails (e.g. a database blip) before the temporary-object cleanup step. The DB row stays
  `UPLOADING`, so a retry safely re-promotes and converges — the orphan risk here is a redundant
  copy on retry, not permanent accumulation, unless the client never retries.
- **Orphaned Bunny video resources**: `createVideoUploadIntent` creates the real Bunny video via
  Bunny's API *before* the Edvora `VideoAsset` row is inserted (an intentional ordering choice — see
  "Implemented Scope" above); if the DB insert itself fails after a successful Bunny create call, the
  Bunny-side resource has no corresponding Edvora row at all.
- **`FAILED` `DocumentAsset`/`VideoAsset` rows**: retained indefinitely once an upload is definitively
  rejected (size/content-type mismatch, signing failure, Bunny-reported encoding failure).

### Security Impact: None

Every student-facing read path derives the object key or Bunny video ID **strictly from a DB row
that has already passed the full READY-plus-entitlement chain** — `StudentDocumentAccessService` and
`StudentVideoAccessService` never accept or discover a raw provider key/GUID from any other source.
An orphaned R2 object or Bunny video resource with no matching `READY`, tenant/entitlement-proven DB
row is therefore **structurally unreachable** through any Edvora API route, regardless of how long it
persists. Instructor list/detail routes are tenant- and DB-scoped, so an orphan with no DB row is
invisible there too. Accumulation is not a confidentiality, integrity, or authorization gap.

### Cost/Operational Impact

Bounded, non-urgent, and provider-billed: extra R2 storage for undiscovered temporary/orphaned
objects, extra Bunny library storage/slot usage for orphaned or abandoned video resources, and
DB row growth in `document_assets`/`video_assets` for stale `UPLOADING`/`FAILED` rows (negligible at
V1 scale; both tables are already indexed on `(tenantId, processingStatus)`). The only
user-observable effect is instructor list/detail views accumulating stale entries over time — a data
hygiene concern, not a security one.

### Recommended Future Cleanup Cadence

Once real scheduling infrastructure exists (a NestJS `@nestjs/schedule` cron, or an external
scheduler calling a new Platform-Admin-only maintenance endpoint), a periodic job — daily is a
reasonable starting cadence — should:

1. Archive or delete `DocumentAsset`/`VideoAsset` rows stuck `UPLOADING` or `FAILED` past a generous
   grace window (e.g. 24–48 hours), using the existing `(tenantId, processingStatus)` index.
2. Delete matching orphaned R2 objects under the `document-uploads/` temporary prefix older than the
   same window.
3. Delete matching orphaned/abandoned Bunny video resources via Bunny's Delete Video API for
   `VideoAsset` rows that never progressed past `UPLOADING`/`FAILED` within the window.

This is intentionally not built now. Shipping V1 without it is safe per the security analysis above.

## DRM-Ready Boundary

Edvora remains DRM-ready, not DRM-implemented. Media Slice G implements real, signed, short-lived
Bunny playback capability issuance — this is authorization, not DRM, and is not claimed to be. Media
Slices C and G preserve the same separation: Edvora's own authorization decision
(`assertAccessibleVideoLesson`) is distinct from the provider-issued playback capability
(`BunnyStreamVideoProvider.createPlaybackCapability`), which is itself distinct from any future
DRM/license enforcement layered on top of it (Bunny MediaCage Basic/Enterprise, Widevine, FairPlay).
No custom encryption, homemade DRM, or fake DRM token is implemented anywhere in this codebase, and no
claim is made that this prevents screen recording, copying after legitimate playback, or
redistribution.
