# Device Authorization

This document defines the V1 backend device-authorization boundary for student protected access.

## Scope

Device authorization is separate from authentication.

Authentication proves who the user is. Device authorization decides whether an authenticated student request is coming from the currently approved app installation. Tenant, enrollment, course, and video/content authorization remain separate future checks.

Implemented backend scope:

- Student first-device authorization.
- Student current-device status check.
- Student device-change request creation.
- Platform Admin device-change approval and rejection.
- A reusable `StudentDeviceGuard` for future protected student routes.

Not implemented here:

- Course/content APIs.
- Enrollment entitlement checks.
- Protected video delivery.
- Frontend/mobile UI.
- Push notifications.
- Hardware fingerprinting.
- Root/jailbreak detection.
- Biometric auth.
- MFA.
- Redis/distributed throttling.

## Installation Identifier

The native student app must later generate and persist an installation-scoped identifier.

V1 transport uses:

```text
X-Edvora-Installation-Id
```

Expected format:

- UUID string.
- Trimmed and lowercased by the API before hashing.
- Stored only as a SHA-256 hash in `StudentDevice.clientDeviceIdHash`.

The installation identifier is not a hardware identity and is not a device fingerprint. It must not use IMEI, serial number, MAC address, advertising ID, location, contacts, or vendor fingerprint aggregation. If app data is fully removed, the identifier may be regenerated and should be treated as a new installation.

The identifier is pseudonymous persistent data used only for device authorization and security investigation. It should not be used for advertising or behavioral tracking.

## Device Metadata

The API accepts only minimal metadata already supported by the schema:

- Platform: `IOS` or `ANDROID`.
- Optional device model label.
- Optional OS version.
- Optional app version.

Metadata is informational. It is not a secret and is not the authorization proof by itself.

## First Device Flow

The student must already be authenticated with a Bearer access token.

Flow:

```text
login
-> authenticated session
-> submit installation identifier
-> backend approves existing/first device or requires change workflow
-> future protected student resources require device authorization
```

When no active device exists, the first valid installation can become `ACTIVE`. If the same installation is already active, the operation is idempotent and updates `lastSeenAt`. If another active device exists, the new installation is not approved and the response indicates that a device change is required.

Two simultaneous first-device attempts are serialized by a PostgreSQL transaction-scoped advisory lock keyed by student ID and protected by the PostgreSQL partial unique index that permits only one `ACTIVE` device per student. The advisory lock is a PostgreSQL implementation detail of the API service, not a cross-database portability promise.

## Existing Device Check

`StudentDeviceGuard` requires:

- A verified authenticated principal from `AccessTokenGuard`.
- Student role where the route requires student-device enforcement.
- `X-Edvora-Installation-Id`.
- Current database state showing an `ACTIVE` device for that student with the matching installation hash.

Device status is checked against PostgreSQL on every guarded request. Device approval is not placed in JWTs so Platform Admin approval/revocation can take effect without waiting for access-token expiry.

## Device Change Requests

A student can request a different installation after another active device already exists.

V1 pending policy:

- One pending request per student.
- Repeating the same candidate installation returns the existing pending request.
- Submitting a different candidate while one is pending returns `DEVICE_CHANGE_ALREADY_PENDING`.
- Instructors cannot approve, reject, or reset student devices.

The PostgreSQL partial unique index enforces at most one `PENDING` request per student. Application transactions turn expected uniqueness races into stable device-domain responses.

## Platform Admin Review

Only a current active `PLATFORM_ADMIN` can approve or reject device-change requests.

Approval is one transaction:

- Verify the request is still `PENDING`.
- Verify the target student is still active and has role `STUDENT`.
- Mark existing active device rows `REPLACED`.
- Activate the requested device.
- Mark the request `APPROVED`.
- Store reviewer/timestamp fields.
- Record a critical device security event.

At commit, a student has at most one active device.

Rejection is one transaction:

- Verify the request is still `PENDING`.
- Preserve the current active device.
- Mark the requested device `REVOKED`.
- Mark the request `REJECTED`.
- Store reviewer/timestamp fields.
- Record a device security event.

Resolved requests cannot be approved or rejected again.

## Sessions And Device State

Logout, logout-all, password change, and password reset affect sessions and credentials. They do not unregister, approve, reject, or replace student devices.

A student may authenticate successfully from a different installation and still fail `StudentDeviceGuard`. This is intentional. Protected student content must later require both authenticated identity and approved-device authorization.

## HTTP Routes

Student routes:

- `POST /student/device/authorize`
- `POST /student/device/change-request`
- `GET /student/device/status`

Platform Admin routes:

- `GET /admin/device-change-requests`
- `POST /admin/device-change-requests/:id/approve`
- `POST /admin/device-change-requests/:id/reject`

All routes require Bearer authentication. Device routes do not use auth refresh cookies as authorization.

## Security Events

Device flows record events for:

- First-device approval.
- Device authorization failure when another active device exists.
- Device-change request creation.
- Device-change approval.
- Device-change rejection.

Events store stable IDs and safe state metadata. They must not store passwords, JWTs, refresh tokens, activation/reset tokens, token hashes, or raw installation identifiers.

## Deferred Controls

Deferred reviewed work:

- Platform Admin standalone device revocation endpoint.
- Instructor/admin UI for reviewing requests.
- Device-change notifications.
- Root/jailbreak/device-attestation signals.
- Distributed rate limiting.
- Cache strategy for device authorization, if later needed with safe invalidation.
