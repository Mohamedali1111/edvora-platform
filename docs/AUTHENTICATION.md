# Authentication

This document defines the V1 authentication and session-security design for Edvora. Internal password, token, refresh-session, account-activation-token, and password-reset-token primitives are implemented in the API. No public endpoints, guards, controllers, cookies, mobile storage, email delivery, or device binding are implemented yet.

## Scope

V1 authentication uses email and password only.

Out of scope for V1 unless later approved:

- Google/Facebook/social login.
- OAuth/OpenID Connect login.
- Magic-link-only login.
- In-app payment or billing linkage.
- MFA.
- External identity providers.
- Redis-backed distributed rate limiting.

## Account Creation Model

V1 has no public Instructor self-registration and no public Student self-registration.

Instructor onboarding:

- Instructor SaaS billing/subscription happens externally with Edvora.
- Platform Admin creates or initiates activation for Instructor accounts.
- Instructor sets their own password through a secure account activation flow.
- Platform Admin must never know, choose, or set a permanent instructor password.

Student onboarding:

- Instructor can create or invite a student by email only within legitimate tenant/course workflows.
- Instructor must never choose, view, or reset a student's permanent password.
- New student uses a single-use account activation mechanism to set their own password.

Existing Edvora student:

- Student identity is global.
- If another instructor/tenant invites an email that already belongs to an existing Edvora Student, do not create a duplicate `User`.
- Do not overwrite existing credentials.
- Link/grant the appropriate tenant/course relationship through the later enrollment/invitation workflow.
- Authentication remains owned by the existing global identity.

Privacy and authorization:

- Instructor/Tenant B must not learn whether a student belongs to another tenant beyond what is needed to complete the invitation/enrollment workflow.
- The backend must authorize the inviting instructor against Tenant B and the target course before creating an invitation or enrollment.
- Any UI response should avoid exposing cross-tenant student history.

## Account Activation

V1 intentionally does not depend on transactional email infrastructure.

The backend should generate a single-use activation URL/token that an authorized Platform Admin or Instructor workflow can copy/share with the intended user through an external channel. Later, an email provider can deliver the same activation URL without redesigning the token model.

Activation token requirements:

- High-entropy random token.
- Minimum 256 bits of entropy.
- Transport-safe representation such as base64url.
- Store only a SHA-256 or equivalent cryptographic digest of the token server-side.
- Store the digest in the canonical lowercase hexadecimal SHA-256 format: exactly 64 characters.
- Purpose-bound to account activation.
- Short operational expiry, initially 7 days unless product/support needs a shorter value.
- Single use with explicit consumed timestamp/state.
- Optional revocation/invalidation timestamp.
- Cannot be used after expiration.
- Cannot be reused after consumption.
- Does not reveal or contain password material.
- HTTPS required in production.
- Raw token must never appear in logs, security-event metadata, analytics, or source control.

Completing activation lets the intended user set their own password. It should not be described as mailbox verification unless the delivery mechanism actually proves mailbox ownership.

## Boundaries

Authentication answers: who is this user?

Authorization answers: what is this user allowed to access?

Device authorization answers: is this student session coming from an approved device?

These must remain separate server-side checks. Do not collapse identity, account status, session validity, device approval, tenant access, enrollment, and course entitlement into one JWT or one middleware decision.

Future protected request sequence:

```text
authenticated identity
-> account status
-> session validity
-> device authorization when required
-> tenant/resource authorization
-> course entitlement
```

Access tokens may help identify a user/session quickly, but the backend remains the source of truth for status, tenant/resource authorization, device authorization, and course entitlement.

## Email Identity

`User` is the canonical identity model. Student, Instructor, and Platform Admin must not have separate authentication identities.

Login identifier behavior:

- Accept email input from the user.
- Trim leading/trailing whitespace.
- Normalize for lookup by lowercasing the email address using a stable server-side normalization function.
- Store the original display email in `User.email`.
- Store the lookup value in `User.normalizedEmail`.
- Use `normalizedEmail` for uniqueness and login lookup.

Do not perform provider-specific transformations such as Gmail dot-removal or plus-address stripping unless a later decision explicitly approves it. Those rules are not universal and can create account-confusion risk.

Login failure responses must not reveal whether the email exists.

## Password Strategy

Use Argon2id for new password hashes.

Reasoning:

- Argon2id is memory-hard and recommended by current OWASP password-storage guidance for password hashing.
- It is more resistant to GPU cracking than plain fast hashes and is preferable to bcrypt for new systems when the Node deployment environment supports it reliably.
- bcrypt remains a reasonable fallback only if Argon2id cannot be supported in the target runtime, but bcrypt's 72-byte input limit must then be handled explicitly.

Initial parameter strategy:

- Start from OWASP's minimum Argon2id profile: about 19 MiB memory, 2 iterations, parallelism 1.
- Benchmark on the actual production-like Node 22 deployment target before launch.
- Tune so normal login is tolerable while making offline cracking materially expensive.
- Do not choose extreme parameters that make local development, CI, or low-cost early production unreliable.

Password hash storage:

- Store only the encoded Argon2id hash string in `AuthCredential.passwordHash`.
- The encoded hash should include algorithm and parameters so old hashes can be verified after parameter upgrades.
- Never store plaintext passwords.
- Never use reversible encryption for passwords.
- Never log password input, password hashes, or password reset tokens.

Verification:

- Verify the submitted password against the stored encoded hash.
- Use the password-hashing library's verification function.
- On successful login, check whether the stored hash uses outdated parameters. If so, rehash with current parameters in the same authenticated flow.

Implementation status:

- The internal API password service uses `argon2@0.45.1` with Argon2id, memory cost 19 MiB, time cost 2, and parallelism 1.
- Password policy validation is implemented for internal callers: minimum 12 characters, maximum 128 characters, no silent truncation, and no composition rules.
- Password hashing is implemented, but no login, password-set, password-change, or password-reset orchestration endpoint exists yet.

Future pepper:

- A server-side pepper may be considered later as defense in depth.
- If adopted, it must live in secret configuration, not the database or source control.
- Pepper rotation needs a deliberate migration/re-hash plan.

## Password Policy

V1 password policy:

- Minimum length: 12 characters initially.
- Maximum length: 128 characters.
- Allow long passphrases.
- Allow Unicode and whitespace.
- Do not silently truncate.
- Do not require uppercase, lowercase, numbers, or special characters.
- Do not force periodic password rotation.

The 12-character minimum is a practical V1 baseline. A 15-character minimum is stronger and should be reconsidered before public self-registration if UX allows.

Future additions:

- Compromised/common password screening.
- Password strength meter.
- MFA for Platform Admin and possibly Instructor accounts.

## Access Token Strategy

Use short-lived signed JWT access tokens for API authentication.

Reasoning:

- The API is shared by mobile and web clients.
- Short-lived JWTs reduce database reads for basic identity extraction.
- Refresh sessions remain server-side and revocable through `RefreshSession`.
- JWTs must not become the authorization source of truth.

Signing:

- Use HS256 initially for V1.
- The signing secret must come from environment/secret management.
- The signing secret must contain at least 256 bits of cryptographic entropy.
- The signing secret must never be committed or logged.
- Future key rotation must remain possible through key identifiers or versioned secret configuration.
- Do not use `none`, weak algorithms, or algorithm choices controlled by token headers.

Minimal claims:

- `sub`: user ID.
- `sid`: refresh session ID.
- `role`: platform role only.
- `iat`: issued at.
- `exp`: expiration.
- `iss`: Edvora API issuer.
- `aud`: intended Edvora API audience.

Do not include:

- Password material.
- Refresh tokens.
- Device secrets.
- Course lists.
- Tenant membership lists.
- Enrollment lists.
- Sensitive PII.
- Full authorization state.

Validation:

- Validate signature, issuer, audience, expiration, and required claims.
- Treat role claim as a convenience hint only. Sensitive authorization still checks account/session/resource state.

Implementation status:

- The internal API access-token service signs and verifies HS256 JWTs through `@nestjs/jwt@11.0.2`.
- Verification explicitly restricts accepted algorithms to HS256 and validates issuer, audience, expiration, and minimal claims.
- Token signing configuration comes from `AUTH_JWT_SECRET`, `AUTH_JWT_ISSUER`, `AUTH_JWT_AUDIENCE`, and optional `AUTH_ACCESS_TOKEN_TTL_SECONDS`.
- `AUTH_JWT_SECRET` is required at runtime and must be at least 32 bytes; examples remain placeholders only.

## Signing Key Strategy

Signing keys must never be hardcoded or committed.

Local development:

- Use local environment variables or local secret files that are ignored by Git.
- Provide examples only with fake placeholders.

Production:

- Load signing keys from production secret configuration.
- Store private keys/secrets outside source control.
- Keep key material out of logs and error messages.

Rotation:

- Access tokens should include a `kid` header once multiple keys/secrets exist.
- Maintain an active signing secret and accepted verification secrets during rotation.
- Because access tokens are short-lived, key rotation can be simpler than long-lived token rotation.
- Emergency key rotation should invalidate outstanding access tokens by removing old verification keys after an appropriate cutover window.

## Refresh Session Strategy

Use random opaque refresh tokens, not refresh JWTs.

Reasoning:

- Opaque refresh tokens give clean server-side revocation.
- Replay detection is easier when the database stores a hash of the active token.
- No authorization state is embedded in a long-lived bearer token.

`RefreshSession` represents a server-side session family for one login context:

- `userId`: authenticated user.
- `deviceId`: nullable now, later used for student device association.
- `status`: `ACTIVE`, `REVOKED`, or `EXPIRED`.
- `refreshTokenHash`: hash of the current refresh token only.
- `expiresAt`: absolute session expiry.
- `lastUsedAt`: last successful refresh.
- `revokedAt`: revocation timestamp when applicable.
- timestamps.

Refresh token format:

- High-entropy random value generated server-side.
- Minimum 256 bits of entropy.
- Base64url or similarly transport-safe representation.
- Never stored in plaintext.
- Stored client-side according to client surface rules.
- Store only a SHA-256 or equivalent cryptographic digest of the token server-side.

A fast cryptographic digest is acceptable for refresh tokens because the token is machine-generated high-entropy random material, unlike a human password. Passwords still require Argon2id because they are human-chosen and vulnerable to offline guessing.

Do not collect excessive session metadata. Security-useful optional metadata may include coarse user-agent summary, coarse IP hash, and request ID in `SecurityEvent`, but avoid invasive fingerprinting and unnecessary PII.

## Refresh Rotation

Refresh flow:

```text
client sends refresh token
-> server hashes token
-> transaction locks/loads matching active RefreshSession
-> verify not expired or revoked
-> rotate to a new refresh token hash
-> update lastUsedAt
-> return new short-lived access token and new refresh token
```

Reuse/replay:

- If an old refresh token is seen after rotation, treat it as possible compromise.
- Revoke the session family by marking the `RefreshSession` `REVOKED`.
- Record a security event.
- Require re-login.

Concurrency:

- Two refresh requests may arrive almost simultaneously from normal client retry behavior.
- Rotation must be transactional.
- Implementation should lock the `RefreshSession` row or use an atomic compare-and-set update on `refreshTokenHash`.
- Exactly one rotation should succeed for a given previous token.
- To avoid accidental lockout from immediate duplicate mobile/network retry, implementation may support a tiny one-time grace window or idempotency key, but only if replay detection remains strong and documented.

Do not let both refresh attempts create indefinitely valid token chains.

Implementation status:

- Refresh-token generation, hashing, session creation, session rotation, current-session revocation, and all-session revocation are implemented as internal API services.
- Future refresh callers must pass the refresh session ID together with the opaque refresh token. The raw refresh token remains opaque and does not carry authorization state.
- Rotation uses a transactional conditional update on `sessionId`, active status, unrevoked state, expiry, and current token hash.
- For near-simultaneous duplicate refresh attempts, one request can rotate successfully and the duplicate is rejected without issuing another chain.
- A stale mismatched token outside the short retry grace window revokes the session and raises replay detection.
- No public `/refresh` or `/logout` endpoint exists yet.

## Session Lifetimes

Initial recommendation:

- Access token lifetime: 10 minutes.
- Refresh session lifetime: 30 days for mobile students.
- Refresh session lifetime: 8 to 12 hours for web Instructor/Admin sessions, with optional "remember this device/browser" decision deferred.

Reasoning:

- Short access tokens limit stale account status and stolen-token exposure.
- Refresh sessions preserve reasonable UX while keeping server-side revocation.
- Admin and instructor web sessions should be more conservative than student mobile sessions.

Final values should be reviewed before production based on UX, support burden, and threat model.

## Account Status Behavior

`ACTIVE`:

- Can login.
- Can refresh.
- Access requests proceed to session/device/authorization checks.

`SUSPENDED`:

- Cannot login.
- Cannot refresh.
- Existing refresh sessions should be revoked during suspension.
- Existing access tokens may remain valid until short expiry unless every request performs DB status checks.
- Security-sensitive or protected-content requests should verify account/session status server-side.

`DELETION_REQUESTED`:

- Default: block new login and refresh except flows needed for deletion/account-support UX.
- Revoke ordinary refresh sessions.
- Future policy may allow a limited account-management session only.

`DELETED`:

- Cannot login.
- Cannot refresh.
- Sessions and credentials should be removed/revoked/anonymized according to retention policy.

Tradeoff:

- Checking account status on every request is safest but costs a database read.
- Short access tokens reduce stale-token exposure.
- V1 should check DB status for sensitive actions and protected content. A later cache can be added only when needed.

## Student Device Integration

Device binding is not implemented in this auth design, but authentication must not undermine it.

First student login:

- Credentials are verified.
- Account/session identity is established.
- Device registration/authorization workflow determines whether protected student access is allowed.

Existing approved student device:

- Credentials plus approved device allow normal session creation and protected access checks.

Different device:

- Credentials may be correct.
- Password possession alone must not authorize course/content access.
- Backend should create or expose the device-change workflow.
- Protected content requires approved device authorization.

Instructor/Admin device policy may differ later. Student session logout must not unregister an approved device.

## Web Session Strategy

Instructor/Admin web should use HttpOnly Secure cookies for refresh/session material where deployment topology allows it.

Recommended shape:

- Refresh token stored in an HttpOnly, Secure cookie.
- SameSite `Lax` for same-site dashboard/API deployments.
- SameSite `None; Secure` only if a cross-site deployment requires it.
- Short-lived access token may be held in memory, or the API may issue it through a refresh endpoint and frontend memory state.
- Do not store refresh tokens in browser localStorage/sessionStorage.

CSRF:

- Cookie-based refresh/logout/password-change endpoints require CSRF protection.
- Use SameSite where possible, plus origin checks and a CSRF token pattern for state-changing cookie-authenticated requests.
- CORS must be explicit and restrictive.

XSS:

- HttpOnly cookies reduce token theft from JavaScript but do not solve XSS.
- XSS can still perform actions as the user.
- CSP, output encoding, dependency review, and frontend security hardening remain required later.

## Mobile Session Strategy

Student mobile:

- Access token: memory where practical.
- Refresh token: platform secure storage/keychain/keystore.
- Do not store refresh tokens in AsyncStorage, plain files, logs, crash reports, or analytics.
- Do not print tokens during debugging.

The exact Expo/React Native secure-storage library is deferred until implementation. The architecture must remain compatible with Expo development/custom builds and future native security plugins.

## Logout

Logout current session:

- Revoke the current `RefreshSession`.
- Clear/expire refresh cookie or secure-storage value.
- Access token expires naturally shortly afterward.
- Record a security event where useful.

Logout all sessions:

- Revoke all active refresh sessions for the user.
- Clear current client session.
- Record a security event.

For students, logout is separate from device registration. Logging out does not unregister the approved device.

## Password Change

Password change policy:

- Require the current password when the user is authenticated.
- Hash the new password with current Argon2id parameters.
- Revoke all other active refresh sessions.
- Keep the current session only if the password change flow re-authenticates successfully and rotates its refresh token.
- Record a security event.
- Future notifications may alert the user.

This balances account takeover risk with a practical user experience.

Password reset/recovery differs from authenticated password change: successful reset should revoke all existing refresh sessions, including the session state associated with potentially compromised credentials.

## Password Reset

Password reset flow:

```text
request reset
-> return generic response
-> create high-entropy single-use reset token
-> store only hashed reset token server-side
-> short expiry
-> user submits token and new password
-> consume token in transaction
-> update password hash
-> revoke active refresh sessions
-> record security event
```

Do not overload `RefreshSession` for password reset tokens.

The schema includes a dedicated `PasswordResetToken` persistence model with user reference, token hash, expiry, consumed timestamp, revocation timestamp, created timestamp, and optional initiating actor reference. Password reset implementation must still generate, hash, consume, and revoke tokens transactionally.

Internal password-reset token generation, replacement revocation, and one-time consumption are implemented. Full password-reset orchestration, password update, refresh-session revocation after successful reset, security-event recording, and delivery are still deferred.

No email provider is selected yet. Reset delivery is deferred.

Early V1 support may allow Platform Admin/support to initiate a reset token workflow, but support staff must never learn or set the user's password. Instructors must not retrieve or reset student passwords directly.

## Email Verification

V1 does not require a separate generic email-verification step before activation.

Completing targeted account activation may establish the initial usable account. However, if activation links are manually delivered through an external channel, Edvora must not claim the user's mailbox was technically verified.

Use precise terms:

- `account activation` when a targeted activation token is consumed.
- `email verified` only when the delivery mechanism actually proves mailbox ownership.

Adding public registration later requires revisiting formal email verification.

Deferral implications:

- Password reset delivery cannot safely rely on email until delivery/verification workflow exists.
- Instructor-created accounts need clear invitation/onboarding rules.
- `emailVerifiedAt` exists and should be populated once verification is implemented.

Do not claim verification exists until implemented.

## Account Creation Responsibility

V1 account creation paths:

- Platform Admin creates or initiates activation for instructors.
- Instructor creates/invites students by email within legitimate tenant/course workflows.
- Platform Admin may support student account creation/invitation when operationally required.
- Public self-registration is not part of V1.

Regardless of creation path, authentication uses the canonical `User`, `AuthCredential`, and `RefreshSession` model.

## Failure Handling

Login:

- Return a generic invalid-credentials response for wrong email/password or unknown account.
- Do not reveal whether an account exists.
- Suspended/deleted account messaging should be careful: enough for legitimate UX after authentication or support path, not enough for enumeration.

Refresh:

- Return a generic invalid/expired/revoked session response.
- Do not reveal token hashes or internal session state.

Device denial later:

- Use stable machine-readable code such as `DEVICE_NOT_AUTHORIZED`.
- Do not expose sensitive device policy internals.

Keep the error taxonomy small and stable.

## Brute Force and Enumeration Protection

V1 should work without Redis initially:

- Generic login failure message.
- Constant-ish response behavior where practical.
- Per-account counters based on normalized email where account exists.
- Per-IP or per-IP-hash counters in process or database-backed records if needed.
- Temporary cooldowns with progressive delay.
- Security event recording for failures and suspicious patterns.

Avoid permanent account lockout after a small number of failures because it enables denial-of-service attacks.

Limitations:

- In-memory throttling is weak across multiple API replicas.
- Database-backed throttling is simpler but can add write load during attacks.
- Redis/distributed rate limiting may be added later when scale or abuse patterns justify it.

## Security Events

Authentication/session events that should create `SecurityEvent` records where appropriate:

- Successful login.
- Failed login.
- Suspicious login failure bursts.
- Refresh token reuse/replay detected.
- Refresh session revoked.
- Logout current session.
- Logout all sessions.
- Password changed.
- Password reset requested, without revealing whether account exists externally.
- Password reset completed.
- Account suspended/deleted.
- Device-not-authorized login/content attempt later.

Metadata must be bounded and scrubbed. Do not store passwords, raw tokens, token hashes unless specifically justified, full user-agent strings if avoidable, or unnecessary PII.

## Transaction Boundaries

Refresh rotation:

- Preserve invariant: one current refresh token hash per active session.
- Lock row or atomically update by old hash and status.
- Detect replay and revoke compromised session.

Password change:

- Preserve invariant: password hash update and session revocation are consistent.
- Update credential, revoke other sessions, rotate current session if kept, record security event.

Password reset completion:

- Preserve invariant: reset token is single-use and cannot race.
- Consume reset token, update password hash, revoke sessions, record event.

Account suspension/deletion:

- Preserve invariant: account status and active session state agree.
- Update account status and revoke refresh sessions together.

Device authorization later:

- Preserve invariant: credentials alone do not authorize protected student content from an unapproved device.

## Threat Review

1. DB is leaked: Argon2id password hashes, opaque refresh-token hashes, no plaintext passwords/tokens, and no sensitive JWT signing keys in DB limit impact.
2. Access token is stolen: short 10-minute lifetime, issuer/audience validation, minimal claims, no refresh token in access token.
3. Refresh token is stolen: server stores only hash; rotation and replay detection revoke compromised session.
4. Old refresh token is replayed: rotation detects reuse and revokes session family.
5. User shares password: authentication may succeed, but student device authorization blocks protected access from unapproved devices.
6. Student logs in from second phone: credentials alone do not replace active device; device-change workflow applies.
7. Suspended user still holds valid access token: short access lifetime limits exposure; sensitive routes should check account/session status.
8. Two refresh requests race: transaction/row lock or atomic compare-and-set permits one valid rotation.
9. Attacker brute-forces login: generic failures, throttling/cooldowns, security events, and later distributed rate limiting.
10. User enumeration through email guessing: generic login/reset responses and careful account-status messaging.
11. Password reset token is stolen: short expiry, hashed storage, single use, session revocation on completion.
12. Web page has XSS: HttpOnly refresh cookie reduces token theft, but XSS remains serious; CSP/frontend hardening required later.
13. CSRF attempt against web session: SameSite, origin checks, and CSRF token pattern for cookie-authenticated state changes.
14. Mobile device is lost: logout-all/session revocation helps; device revocation/change workflow is separate and required for protected content.
15. Student logs out and logs back in on same approved device: session changes, device remains approved unless explicitly revoked.

## Deferred Controls

Deferred until implementation or later reviewed tasks:

- Installing cookie/CSRF/frontend security transport libraries.
- Public auth controllers, route guards, DTOs, decorators, and orchestration services.
- Email provider and email verification workflow.
- MFA.
- Redis/distributed rate limiting.
- Device binding implementation.
- Web CSRF implementation.
- Mobile secure-storage library selection.
- Production key-management service.

MFA for Instructor and especially Platform Admin is a high-priority pre-production hardening item. It is not a blocker for initial local backend development.

## Schema Plan

Implemented persistence exists for:

- `AccountActivationToken`
- `PasswordResetToken`

Internal issuance/consumption primitives for these persistence models are implemented, but no public auth code or delivery flow exists yet. See `docs/AUTH-SCHEMA-PLAN.md` for fields, constraints, indexes, lifecycle, and remaining application responsibilities.

## References

- OWASP Password Storage Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
- OWASP Authentication Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html
- OWASP JSON Web Token Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/JSON_Web_Token_Cheat_Sheet.html
