# Security

## Security Position

Security is a core product differentiator for Edvora. It must be threat-oriented, server-enforced, auditable, and honest about platform limits.

Software cannot guarantee that a person will never record a physical screen with another camera. Edvora's objective is strong deterrence, access control, DRM/content protection readiness, traceability, and abuse detection, not an impossible "100% piracy-proof" claim.

## Threat-Oriented Principles

- Enforce access on the server, not only in the mobile or web UI.
- Treat protected content, course entitlement, device authorization, sessions, and admin operations as security boundaries.
- Keep sensitive authentication material out of logs and source control.
- Prefer explicit authorization decisions over implicit trust in client state.
- Record security-relevant events so abuse can be investigated.
- Avoid invasive or policy-violating device fingerprinting.
- Keep security architecture adaptable for future device-trust, root/jailbreak detection, and DRM provider choices.

## Authentication and Sessions

The backend must own authentication and session handling. The future implementation should support:

- Short-lived access tokens.
- Secure refresh/session handling.
- Server-side session invalidation where needed.
- No secrets, passwords, refresh tokens, access tokens, or sensitive session material in logs.
- Clear separation between authentication and authorization.

## Authorization Requirements

Authorization must verify role, tenant access, resource ownership, device authorization where applicable, and course entitlement before protected operations.

Clients may send identifiers needed to request data, but the backend must not trust tenant IDs, role claims, enrollment claims, device claims, or entitlement claims without server-side verification.

Platform Admin authorization must be explicit and separate from tenant-scoped instructor authorization.

## Device Binding Requirements

V1 defaults to one approved active device per student. This default must remain configurable in architecture rather than permanently hardcoded.

Expected behavior:

- The first approved student device becomes registered/authorized.
- A login from another device must not automatically replace the currently approved device.
- Device authorization must be enforced server-side.
- Device records should be designed so future device-trust signals can be added without redesigning the domain.
- Device identifiers must avoid invasive or policy-violating fingerprinting.

## Device-Change Workflow

When a student needs to use a different device:

1. The student submits a device-change request.
2. The backend records the request and relevant security context.
3. A `PLATFORM_ADMIN` reviews the request.
4. The Platform Admin approves or rejects the request.
5. Approved changes update the student's authorized device state according to policy.

Instructors must not approve or reset student devices in V1.

## Content Protection Requirements

Course entitlement and content authorization must be server-enforced. Protected lesson content should require the backend to verify the student's identity, tenant boundary, enrollment/access, device authorization, and content permissions.

Raw permanent video URLs must never be exposed as the security model.

## Video Security and DRM-Ready Principles

Video infrastructure will be selected later after an explicit technical and cost evaluation. Edvora must not self-build fake DRM.

The architecture should be ready for:

- Time-limited playback authorization.
- Signed or tokenized playback access.
- DRM-capable provider integration if required.
- CDN/object-storage/video platform delivery.
- Revocation or expiration of playback access.
- Server-side audit trails for sensitive playback decisions.

NestJS should not become the component that streams every video byte in production.

## Watermarking

Protected content should support dynamic user-identifying watermarks where technically appropriate. Watermarking is intended for deterrence and traceability, not as a guarantee that piracy is impossible.

## Platform-Native Protections

Screenshot and screen-recording protection should use supported platform-native capabilities where technically possible. Native security features must use public supported APIs and remain compatible with Apple App Store and Google Play policies.

## Security Events

The system should record security-relevant events such as sign-ins, failed sign-ins, device registrations, device-change requests, device-change approvals/rejections, authorization failures, suspicious playback attempts, and administrative security actions.

Events should be structured enough for audit and investigation while avoiding sensitive secrets or tokens.

## Logging Restrictions

Never log:

- Passwords
- Access tokens
- Refresh tokens
- Session secrets
- API keys
- Private signing keys
- Raw sensitive authentication material

Logs should use request/correlation IDs and structured fields where possible.

## Future Hardening

Future hardening may include root/jailbreak signals, device attestation, anomaly detection, rate limiting improvements, stronger audit workflows, DRM provider integration, and advanced monitoring. These are architectural requirements and future capabilities, not implemented features today.
