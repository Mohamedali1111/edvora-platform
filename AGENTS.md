# Edvora Engineering Instructions

Edvora is production-quality commercial SaaS work, not a disposable prototype. Every Codex, Cursor, AI, and human contributor must treat this repository as the durable source of truth for a security-first bilingual EdTech platform.

## Operating Principles

- Follow the requested task scope exactly. Do not silently expand product, infrastructure, or dependency scope.
- Preserve documented architectural decisions. If a previous decision becomes unsafe, invalid, or materially outdated, report it before changing it.
- Avoid destructive changes without explicit instruction.
- Avoid paid services, managed infrastructure, or vendor commitments unless explicitly approved.
- Do not introduce infrastructure such as Redis, queues, Docker, CI/CD, analytics, caches, or cloud services without a clear demonstrated need.
- Do not present placeholders, stubs, mock behavior, or future intentions as completed product capability.
- Run relevant validation before completing every task. Never claim something was tested unless it actually was.
- Report changed files, decisions, dependencies, validation results, assumptions, limitations, and unfinished work after each task.

## Product Boundaries

- V1 has exactly three primary roles: `STUDENT`, `INSTRUCTOR`, and `PLATFORM_ADMIN`.
- Instructors are Edvora's paying customers. Instructor subscription handling is external/manual in V1.
- The student mobile app must not contain in-app payment, checkout, course purchase, subscription purchase, Stripe, Paymob, or equivalent purchase flows in V1.
- Student V1 is a native mobile app for iOS and Android.
- Instructor and Platform Admin dashboards live in one responsive web application with role-based routing and authorization.
- All product surfaces share one backend API.

## Security Requirements

- Security must be enforced server-side. Do not build fake security that only hides buttons or screens in a client.
- Authentication, authorization, course entitlement, device authorization, and secure playback authorization must be backend-controlled.
- One approved active device per student is the V1 default, but the architecture must keep device limits configurable.
- Student device changes are requested by the student and approved or rejected by `PLATFORM_ADMIN`.
- Instructors must not approve or reset student devices in V1.
- Raw permanent video URLs must never be the security model.
- Keep the architecture DRM-ready, watermark-ready, audit-ready, and compatible with future root/jailbreak/device-trust checks.
- No invasive or policy-violating device fingerprinting.
- Secrets, access tokens, passwords, refresh tokens, session material, and sensitive authentication data must never appear in source control or logs.
- Do not suppress errors just to make CI or validation pass.

## Bilingual UI Requirements

- Arabic and English are first-class requirements from day one.
- English is LTR. Arabic is RTL.
- UI copy must use localization keys once implementation begins; do not hardcode user-facing product copy inside components.
- Components must support both text directions without duplicated Arabic and English screen implementations.
- Directional icons must mirror when their meaning depends on direction. Icons with fixed semantic meaning must not be mirrored.
- Text alignment, spacing, navigation, forms, tables, dialogs, and back/forward interactions must work in both directions.
- Arabic and English require equal QA attention.

## UI Quality Requirements

- Responsive design is mandatory for mobile, tablet, laptop, and desktop surfaces as appropriate.
- Accessibility must be considered from implementation time, not added at the end.
- UI work must receive visual QA, not only typechecking or build verification.
- Avoid arbitrary fixed-width layouts, overlapping content, horizontal overflow, and screens that fail with long Arabic or English text.
- Avoid generic, bloated, over-card-based LMS UI. Build focused product workflows.
- Do not choose final fonts, colors, logos, or visual branding until that is explicitly requested.

## Code Quality Requirements

- Use strong TypeScript.
- Use clear naming and small focused modules.
- Avoid giant components, giant services, duplicated business logic, dead code, and speculative abstractions.
- Avoid unnecessary dependencies.
- Do not use unsafe `any` unless there is a documented exceptional reason.
- Keep business rules centralized in appropriate server-side/domain layers rather than duplicating them across clients.
- Prefer established local patterns once they exist.

## Compliance Requirements

- Preserve Apple App Store and Google Play compliance from the beginning.
- Use only supported public platform APIs for native security behavior.
- Keep privacy disclosures, account deletion, reviewer/demo access, minimal permissions, SDK review, and store metadata accuracy in mind for every relevant change.
- Do not claim App Store or Google Play approval can be guaranteed.

## Required Reading

Before modifying product code or architecture, read this file and the relevant files in `docs/`, especially:

- `docs/PRODUCT.md`
- `docs/ARCHITECTURE.md`
- `docs/SECURITY.md`
- `docs/UI-GUIDELINES.md`
- `docs/RELEASE-COMPLIANCE.md`
- `docs/RELIABILITY.md`
- `docs/DECISIONS.md`
- `docs/STATUS.md`
