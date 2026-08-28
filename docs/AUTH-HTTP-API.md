# Authentication HTTP API

This document records the V1 public authentication HTTP boundary for Edvora's shared API. It documents transport behavior only; it is not a full OpenAPI replacement.

## Scope

Implemented routes:

- `POST /auth/login`
- `POST /auth/refresh`
- `POST /auth/logout`
- `POST /auth/logout-all`
- `POST /auth/activate`
- `POST /auth/password/change`
- `POST /auth/password/reset/complete`

Authentication still does not imply device approval, tenant access, enrollment, or course entitlement.

```text
Authentication
-> account/session state
-> device authorization
-> tenant/resource authorization
-> enrollment entitlement
```

Student content routes must not treat a valid `STUDENT` access token as approved-device or course-access proof.

## Error Shape

Authentication routes return stable machine-readable errors:

```json
{
  "error": {
    "code": "INVALID_CREDENTIALS",
    "message": "Invalid credentials."
  }
}
```

Messages are intentionally short English operational text. Future clients should localize based on `error.code`.

Sensitive implementation details are not exposed: Prisma errors, JWT library messages, Argon2 errors, stack traces, token hashes, and database constraint names are not part of the public auth contract.

## Login

`POST /auth/login`

Request:

```json
{
  "email": "user@example.com",
  "password": "user password",
  "channel": "WEB"
}
```

`channel` must be `WEB` or `MOBILE`.

Common response fields:

```json
{
  "accessToken": "...",
  "accessTokenExpiresAt": "2026-08-23T12:10:00.000Z",
  "sessionId": "...",
  "user": {
    "id": "...",
    "role": "STUDENT"
  }
}
```

For `MOBILE`, the response also includes:

```json
{
  "refreshToken": "...",
  "refreshTokenExpiresAt": "2026-09-22T12:00:00.000Z"
}
```

For `WEB`, the raw refresh token is never returned in JSON. It is set in an HttpOnly refresh cookie.

Invalid email/password and unknown account return the same public error:

- HTTP `401`
- `INVALID_CREDENTIALS`

## Refresh

`POST /auth/refresh`

For `MOBILE`, the refresh token is explicit request material:

```json
{
  "channel": "MOBILE",
  "sessionId": "...",
  "refreshToken": "..."
}
```

For `WEB`, the request body contains only:

```json
{
  "channel": "WEB"
}
```

The API reads the refresh token and session ID from cookies. Web refresh does not accept body refresh-token fallback.

On successful mobile refresh, the response includes the rotated raw refresh token. On successful web refresh, the API rotates cookies and returns only the new access token/session metadata.

On failed web refresh, auth cookies are cleared where practical.

## Web Cookie Policy

The web refresh transport uses two auth-specific cookies:

- `edvora_refresh`: opaque refresh token.
- `edvora_session`: refresh session ID.

Both cookies use:

- `HttpOnly`
- finite expiry aligned with the refresh session expiry
- path `/auth`
- explicit SameSite policy, default `Lax`
- `Secure` in production

The cookie names and path are configurable. Production must not disable secure refresh cookies.

`SameSite=None` is allowed only with `Secure` cookies and should be revisited only if cross-site deployment becomes necessary.

## CSRF / Origin Protection

Cookie-backed web auth requests require trusted `Origin` validation in addition to SameSite cookies.

The API rejects web-channel or web-cookie auth requests when:

- `Origin` is missing where required.
- `Origin` is not in the configured trusted web origins.

Mobile refresh uses explicit bearer/body material and is not forced through browser-cookie CSRF assumptions.

CORS is credentialed but restricted to configured trusted web origins. Wildcard credentialed CORS is not allowed.

## Access Token Guard

Protected auth routes use:

```text
Authorization: Bearer <access-token>
```

The guard verifies the access token through the internal `AccessTokenService` and attaches only:

- `userId`
- `sessionId`
- `platformRole`

Request body, query parameters, or custom client headers cannot override the authenticated user/session/role.

The guard does not perform device authorization, tenant authorization, or course entitlement checks.

## Logout

`POST /auth/logout`

Requires Bearer access token.

The server revokes only the authenticated user's current refresh session from the verified JWT `sid`. Request body session IDs are not accepted.

For web requests with auth cookies, the cookies are cleared. Logout does not unregister a student's approved device.

Success returns `204 No Content`.

## Logout All

`POST /auth/logout-all`

Requires Bearer access token.

The server revokes active refresh sessions belonging to the authenticated user only. It does not affect other users, devices, account status, tenant access, or course enrollment.

For web requests with auth cookies, the current cookies are cleared.

Success returns `204 No Content`.

## Password Change

`POST /auth/password/change`

Requires Bearer access token.

Request:

```json
{
  "currentPassword": "old password",
  "newPassword": "new password"
}
```

The authenticated user ID and current session ID come from the verified access token, not the request body.

On success, the internal orchestration updates the credential, revokes other sessions, rotates the current session, and returns a fresh access token. Web requests receive the rotated refresh token through cookies only. Mobile requests receive the rotated refresh token in the response body.

## Activation Completion

`POST /auth/activate`

Unauthenticated. The activation token is the capability.

Request:

```json
{
  "activationToken": "...",
  "purpose": "STUDENT_ACTIVATION",
  "newPassword": "new password"
}
```

`purpose` must match the token's stored `AccountActivationPurpose`; instructor and student activation tokens are not interchangeable.

Success returns `204 No Content`. Activation does not issue access/refresh tokens, does not mark email as verified, and does not authorize a student device.

## Password Reset Completion

`POST /auth/password/reset/complete`

Unauthenticated. The reset token is the capability.

Request:

```json
{
  "resetToken": "...",
  "newPassword": "new password"
}
```

Success consumes the reset token, updates the credential, revokes all refresh sessions, and returns `204 No Content`. It does not auto-login and does not authorize a device.

If web refresh cookies are present, they are cleared.

## Rate Limiting

Auth routes use initial in-process Nest throttling on abuse-sensitive endpoints.

Current limitation:

- This is useful for a single API process.
- It is not horizontally consistent across replicas.
- Before horizontal scaling or serious abuse exposure, Edvora must move to shared/distributed throttling or another coordinated rate-limit strategy.

Rate limiting is IP-based at the HTTP layer. The API must not trust arbitrary `X-Forwarded-For` headers until reverse-proxy trust configuration is explicitly established.

Rate limiting does not create permanent account lockout.

## Response Caching

Token-bearing auth responses set:

- `Cache-Control: no-store`
- `Pragma: no-cache`

Auth tokens must not be cached by browsers, proxies, or intermediary layers.
