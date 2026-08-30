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

Student video playback and document viewing/downloading are deferred. Future student media access must compose:

```text
authenticated student
-> approved student device
-> active tenant-student association
-> active enrollment
-> published/available course lesson
-> runtime playback/download authorization
```

Permanent raw/public media URLs must never become the authorization model.

## DRM-Ready Boundary

Edvora remains DRM-ready, not DRM-implemented. This slice does not claim DRM, simulate DRM, or choose a provider. DRM-capable provider evaluation remains a future technical and cost decision.
